import {
  buildTimeWindows,
  filterRelevantCommits,
  normalizeCommitMessage,
  splitRepoName,
} from "@/lib/generateDayDrafts";
import {
  getSyncConfig,
  hasEntriesForSyncKey,
  listActiveSyncConfigs,
  persistDailyDraft,
  recordSyncRun,
  upsertSyncConfig,
} from "@/lib/sheet-store";
import { sendTelegramReminder } from "@/lib/telegram";
import { Commit, SyncConfigRecord, TimesheetEntry, TimeWindow } from "@/types/timesheet";

function getAiResponseSchema(timeWindows: readonly TimeWindow[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      entries: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            project: { type: "string" },
            startTime: { type: "string", enum: timeWindows.map((window) => window.start) },
            endTime: { type: "string", enum: timeWindows.map((window) => window.end) },
            description: { type: "string" },
          },
          required: ["project", "startTime", "endTime", "description"],
        },
      },
    },
    required: ["entries"],
  } as const;
}

function getSystemPrompt(timeWindows: readonly TimeWindow[]) {
  return [
    "Voce gera rascunhos de timesheet em portugues do Brasil.",
    "Use apenas evidencias reais dos commits.",
    "Nao invente atividade.",
    `Gere no maximo 2 entradas por dia, usando apenas estas faixas: ${timeWindows
      .map((window) => `${window.start}-${window.end}`)
      .join(" e ")}.`,
    "Se nao houver evidencia suficiente para dois blocos, retorne apenas um.",
    "As descricoes devem ser curtas, profissionais e agregadas por objetivo entregue.",
    "Nao copie os commits literalmente; sintetize em linguagem natural de trabalho.",
    "Escreva sempre em portugues do Brasil, mesmo se os commits estiverem em ingles.",
    "Retorne apenas JSON valido no formato {\"entries\":[...]} sem markdown.",
  ].join(" ");
}

function getPromptPayload(date: string, dayCommits: Commit[], timeWindows: readonly TimeWindow[]) {
  return {
    date,
    allowedWindows: timeWindows,
    rules: [
      "Nao inventar atividades ausentes nos commits.",
      "Consolidar commits relacionados em um resumo de entrega.",
      "Escrever em portugues do Brasil.",
      "Evitar repetir o texto bruto dos commits quando der para resumir melhor.",
      "Usar o nome curto do repositorio em project.",
      "Gerar no maximo duas entradas.",
    ],
    commits: dayCommits.map((commit) => ({
      time: commit.date,
      repo: splitRepoName(commit.repo),
      branch: commit.branch || null,
      message: normalizeCommitMessage(commit.message),
    })),
  };
}

function normalizeProject(project: string, dayCommits: Commit[]) {
  const cleaned = project.trim();
  if (!cleaned) {
    return splitRepoName(dayCommits[0]?.repo ?? "Projeto");
  }

  const byShortName = new Map(
    dayCommits.map((commit) => [splitRepoName(commit.repo).toLowerCase(), splitRepoName(commit.repo)]),
  );
  return byShortName.get(cleaned.toLowerCase()) ?? cleaned;
}

function parseJsonContent(content: unknown) {
  if (typeof content === "string") {
    return JSON.parse(content) as { entries: Array<{ project: string; startTime: string; endTime: string; description: string }> };
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("");

    return JSON.parse(text) as { entries: Array<{ project: string; startTime: string; endTime: string; description: string }> };
  }

  throw new Error("O provedor de IA nao retornou conteudo em texto.");
}

function validateAiEntries(
  entries: Array<{ project: string; startTime: string; endTime: string; description: string }>,
  date: string,
  dayCommits: Commit[],
  timeWindows: readonly TimeWindow[],
) {
  const allowedWindowKeys = new Set(timeWindows.map((window) => `${window.start}-${window.end}`));
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 2) {
    return null;
  }

  const normalizedEntries: TimesheetEntry[] = [];
  const usedWindows = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    if (!entry?.description?.trim()) {
      return null;
    }

    const windowKey = `${entry.startTime}-${entry.endTime}`;
    if (!allowedWindowKeys.has(windowKey) || usedWindows.has(windowKey)) {
      return null;
    }

    usedWindows.add(windowKey);
    normalizedEntries.push({
      id: `${date}-${index + 1}`,
      project: normalizeProject(entry.project, dayCommits),
      date,
      description: entry.description.trim(),
      startTime: entry.startTime,
      endTime: entry.endTime,
    });
  }

  return normalizedEntries.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

async function generateEntriesWithProvider(date: string, dayCommits: Commit[], timeWindows: readonly TimeWindow[]) {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "pollinations";

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY nao configurada.");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: { name: "timesheet_day_draft", schema: getAiResponseSchema(timeWindows) },
        },
        messages: [
          { role: "system", content: getSystemPrompt(timeWindows) },
          { role: "user", content: JSON.stringify(getPromptPayload(date, dayCommits, timeWindows)) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI retornou ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    return validateAiEntries(parseJsonContent(data.choices?.[0]?.message?.content).entries, date, dayCommits, timeWindows);
  }

  const endpoint = process.env.POLLINATIONS_API_URL || "https://gen.pollinations.ai/v1/chat/completions";
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (process.env.POLLINATIONS_API_KEY?.trim()) {
    headers.Authorization = `Bearer ${process.env.POLLINATIONS_API_KEY.trim()}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.POLLINATIONS_MODEL || "openai",
      temperature: 0.2,
      max_tokens: 1200,
      reasoning_effort: "low",
      response_format: {
        type: "json_schema",
        json_schema: { name: "timesheet_day_draft", schema: getAiResponseSchema(timeWindows) },
      },
      messages: [
        { role: "system", content: getSystemPrompt(timeWindows) },
        { role: "user", content: JSON.stringify(getPromptPayload(date, dayCommits, timeWindows)) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Pollinations retornou ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  return validateAiEntries(parseJsonContent(data.choices?.[0]?.message?.content).entries, date, dayCommits, timeWindows);
}

function getCredential(config: SyncConfigRecord) {
  return config.githubPat?.trim() || config.githubAccessToken?.trim() || "";
}

function buildTelegramReminderMessage(date: string, entries: TimesheetEntry[]) {
  const lines = [
    `GitSheet: o dia ${date.split("-").reverse().join("/")} entrou na sheet.`,
    "",
    ...entries.map((entry) => `- ${entry.startTime}-${entry.endTime} ${entry.project}: ${entry.description}`),
  ];

  return lines.join("\n");
}

export async function fetchCommitsForDate(date: string, config: SyncConfigRecord) {
  const token = getCredential(config);
  if (!token || config.status !== "active") {
    return [];
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const allCommits = await Promise.all(
    config.repos.map(async (repo) => {
      const branchParam = repo.selectedBranch ? `&sha=${encodeURIComponent(repo.selectedBranch)}` : "";
      const url = `https://api.github.com/repos/${repo.fullName}/commits?author=${encodeURIComponent(config.userId)}&since=${date}T00:00:00Z&until=${date}T23:59:59Z&per_page=100${branchParam}`;
      const response = await fetch(url, { headers, cache: "no-store" });

      if (!response.ok) {
        return [];
      }

      const commits = (await response.json()) as Array<{
        sha: string;
        commit: { message: string; author: { date: string } };
      }>;

      return commits.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message.split("\n")[0],
        repo: repo.fullName,
        date: commit.commit.author.date,
        branch: repo.selectedBranch || undefined,
      }));
    }),
  );

  return allCommits.flat();
}

export async function syncDateForConfig(config: SyncConfigRecord, date: string) {
  return syncDateForConfigWithTrigger(config, date, "worker");
}

export async function syncTodayForUser(userId: string) {
  const config = getSyncConfig(userId);
  if (!config || config.status !== "active") {
    return { synced: false, reason: "missing-config" as const, userId };
  }

  return syncDateForConfigWithTrigger(config, new Date().toISOString().slice(0, 10), "ui");
}

export async function syncAllActiveUsersForDate(date: string) {
  const configs = listActiveSyncConfigs();
  const results = [];

  for (const config of configs) {
    try {
      results.push(await syncDateForConfigWithTrigger(config, date, "worker"));
    } catch (error) {
      results.push({
        synced: false,
        reason: "error" as const,
        date,
        userId: config.userId,
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  }

  return results;
}

async function syncDateForConfigWithTrigger(
  config: SyncConfigRecord,
  date: string,
  trigger: "ui" | "worker",
) {
  try {
    const syncKey = `daily:${date}`;
    const timeWindows = buildTimeWindows({
      firstBlockStart: config.firstBlockStart,
      firstBlockEnd: config.firstBlockEnd,
      secondBlockStart: config.secondBlockStart,
      secondBlockEnd: config.secondBlockEnd,
    });
    const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
    const shouldSkip =
      (dayOfWeek === 6 && !config.includeSaturday) ||
      (dayOfWeek === 0 && !config.includeSunday);

    if (shouldSkip) {
      recordSyncRun({
        userId: config.userId,
        runDate: date,
        trigger,
        status: "skipped",
        reason: "calendar-skip",
        message: "A data foi ignorada pela regra de sábado/domingo.",
      });
      return { synced: false, reason: "calendar-skip" as const, date, userId: config.userId };
    }

    if (hasEntriesForSyncKey(config.userId, syncKey)) {
      recordSyncRun({
        userId: config.userId,
        runDate: date,
        trigger,
        status: "skipped",
        reason: "already-synced",
        message: "O dia ja possui entradas geradas e nao sera sincronizado novamente.",
      });
      return { synced: false, reason: "already-synced" as const, date, userId: config.userId };
    }

    const commits = filterRelevantCommits(await fetchCommitsForDate(date, config));
    if (!commits.length) {
      upsertSyncConfig({
        userId: config.userId,
        repos: config.repos,
        includeSaturday: config.includeSaturday,
        includeSunday: config.includeSunday,
        telegramReminderEnabled: config.telegramReminderEnabled,
        firstBlockStart: config.firstBlockStart,
        firstBlockEnd: config.firstBlockEnd,
        secondBlockStart: config.secondBlockStart,
        secondBlockEnd: config.secondBlockEnd,
        initialMonth: config.initialMonth,
        bootstrapStartDate: config.bootstrapStartDate,
        bootstrapEndDate: config.bootstrapEndDate,
        lastSuccessfulSyncDate: date,
        status: config.status,
        githubPat: config.githubPat,
        githubAccessToken: config.githubAccessToken,
      });
      recordSyncRun({
        userId: config.userId,
        runDate: date,
        trigger,
        status: "skipped",
        reason: "no-commits",
        message: "Nenhum commit relevante foi encontrado para o dia.",
      });
      return { synced: false, reason: "no-commits" as const, date, userId: config.userId };
    }

    const entries = await generateEntriesWithProvider(date, commits, timeWindows);
    if (!entries?.length) {
      throw new Error(`A IA nao conseguiu gerar um resumo valido para ${date}.`);
    }

    persistDailyDraft(config.userId, date, entries);
    upsertSyncConfig({
      userId: config.userId,
      repos: config.repos,
      includeSaturday: config.includeSaturday,
      includeSunday: config.includeSunday,
      telegramReminderEnabled: config.telegramReminderEnabled,
      firstBlockStart: config.firstBlockStart,
      firstBlockEnd: config.firstBlockEnd,
      secondBlockStart: config.secondBlockStart,
      secondBlockEnd: config.secondBlockEnd,
      initialMonth: config.initialMonth,
      bootstrapStartDate: config.bootstrapStartDate,
      bootstrapEndDate: config.bootstrapEndDate,
      lastSuccessfulSyncDate: date,
      status: config.status,
      githubPat: config.githubPat,
      githubAccessToken: config.githubAccessToken,
    });
    recordSyncRun({
      userId: config.userId,
      runDate: date,
      trigger,
      status: "success",
      reason: "ok",
      message: `${entries.length} entrada(s) gerada(s) para o dia.`,
    });

    if (config.telegramReminderEnabled) {
      try {
        await sendTelegramReminder(buildTelegramReminderMessage(date, entries));
      } catch (error) {
        console.error(
          `[telegram-reminder] user=${config.userId} date=${date} error=${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    return { synced: true, reason: "ok" as const, date, userId: config.userId, entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    recordSyncRun({
      userId: config.userId,
      runDate: date,
      trigger,
      status: "error",
      reason: "error",
      message,
    });
    throw error;
  }
}
