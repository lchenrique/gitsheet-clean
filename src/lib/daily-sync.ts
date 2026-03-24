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

const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Sao_Paulo";

function formatDateInTimezone(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getCurrentSyncDate() {
  return formatDateInTimezone(new Date());
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function getUtcDayRangeForTimezone(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, 2, 59, 59));
  return {
    since: start.toISOString().replace(".000Z", "Z"),
    until: end.toISOString().replace(".000Z", "Z"),
  };
}

function resolvePendingStartDate(config: SyncConfigRecord) {
  // If there's a bootstrap, start from the bootstrap start date
  if (config.bootstrapStartDate) {
    return config.bootstrapStartDate;
  }

  // Otherwise start from the last date that had commits
  const lastWithCommits = config.lastDateWithCommits;
  if (lastWithCommits) {
    return lastWithCommits;
  }

  return getCurrentSyncDate();
}

async function markSyncProgress(config: SyncConfigRecord, date: string, hasCommits: boolean) {
  await upsertSyncConfig({
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
    lastDateWithCommits: hasCommits ? date : config.lastDateWithCommits,
    status: config.status,
    githubPat: config.githubPat,
    githubAccessToken: config.githubAccessToken,
  });
}

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

function ensureTwoEntriesPerDay(
  entries: TimesheetEntry[],
  date: string,
  dayCommits: Commit[],
  timeWindows: readonly TimeWindow[],
) {
  if (entries.length >= 2) {
    return entries;
  }

  const [morningWindow, afternoonWindow] = timeWindows;
  const baseEntry = entries[0] ?? {
    id: `${date}-1`,
    project: normalizeProject("", dayCommits),
    date,
    description: normalizeCommitMessage(dayCommits[0]?.message ?? "Trabalho executado no período."),
    startTime: morningWindow.start,
    endTime: morningWindow.end,
  };

  const description = baseEntry.description.trim();
  const project = baseEntry.project;

  return [
    {
      ...baseEntry,
      id: `${date}-1`,
      project,
      date,
      description,
      startTime: morningWindow.start,
      endTime: morningWindow.end,
    },
    {
      ...baseEntry,
      id: `${date}-2`,
      project,
      date,
      description: description.startsWith("Continuidade:")
        ? description
        : `Continuidade: ${description}`,
      startTime: afternoonWindow.start,
      endTime: afternoonWindow.end,
    },
  ];
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

  return ensureTwoEntriesPerDay(
    normalizedEntries.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    date,
    dayCommits,
    timeWindows,
  );
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

function getCredentials(config: SyncConfigRecord) {
  return [config.githubPat?.trim(), config.githubAccessToken?.trim()].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );
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
  const credentials = getCredentials(config);
  if (!credentials.length || config.status !== "active") {
    return [];
  }
  const { since, until } = getUtcDayRangeForTimezone(date);
  let authFailed = false;

  for (const token of credentials) {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    };

    try {
      const allCommits = await Promise.all(
        config.repos.map(async (repo) => {
          const branchParam = repo.selectedBranch ? `&sha=${encodeURIComponent(repo.selectedBranch)}` : "";
          const url = `https://api.github.com/repos/${repo.fullName}/commits?author=${encodeURIComponent(config.userId)}&since=${since}&until=${until}&per_page=100${branchParam}`;
          const response = await fetch(url, { headers, cache: "no-store" });

          if (response.status === 401 || response.status === 403) {
            authFailed = true;
            throw new Error("github-auth");
          }

          if (!response.ok) {
            throw new Error(`GitHub retornou ${response.status} ao consultar ${repo.fullName}.`);
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
    } catch (error) {
      if (error instanceof Error && error.message === "github-auth") {
        continue;
      }
      throw error;
    }
  }

  if (authFailed) {
    throw new Error("Não foi possível consultar o GitHub: credencial inválida ou sem permissão para os repositórios configurados.");
  }

  return [];
}

export async function syncDateForConfig(config: SyncConfigRecord, date: string) {
  return syncSingleDateForConfig(config, date, "worker");
}

export async function syncTodayForUser(userId: string) {
  const config = await getSyncConfig(userId);
  if (!config || config.status !== "active") {
    return [{ synced: false, reason: "missing-config" as const, userId, date: getCurrentSyncDate() }];
  }

  return syncPendingDatesForConfig(config, getCurrentSyncDate(), "ui");
}

export async function syncAllActiveUsersForDate(date: string) {
  const configs = await listActiveSyncConfigs();
  const results = [];

  for (const config of configs) {
    try {
      results.push(...(await syncPendingDatesForConfig(config, date, "worker")));
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

export async function syncPendingDatesForConfig(
  config: SyncConfigRecord,
  endDate: string,
  trigger: "ui" | "worker",
) {
  const results = [];
  let currentDate = resolvePendingStartDate(config);

  while (currentDate <= endDate) {
    results.push(await syncSingleDateForConfig(config, currentDate, trigger));
    currentDate = addDays(currentDate, 1);
  }

  if (results.length === 0) {
    results.push({
      synced: false,
      reason: "up-to-date" as const,
      date: endDate,
      userId: config.userId,
    });
  }

  return results;
}

async function syncSingleDateForConfig(
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
      await markSyncProgress(config, date, false);
      await recordSyncRun({
        userId: config.userId,
        runDate: date,
        trigger,
        status: "skipped",
        reason: "calendar-skip",
        message: "A data foi ignorada pela regra de sábado/domingo.",
      });
      return { synced: false, reason: "calendar-skip" as const, date, userId: config.userId };
    }

    if (await hasEntriesForSyncKey(config.userId, syncKey)) {
      await markSyncProgress(config, date, false);
      await recordSyncRun({
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
      await markSyncProgress(config, date, false);
      await recordSyncRun({
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

    await persistDailyDraft(config.userId, date, entries);
    await markSyncProgress(config, date, true);
    await recordSyncRun({
      userId: config.userId,
      runDate: date,
      trigger,
      status: "success",
      reason: "ok",
      message: `${commits.length} commit(s) processado(s), ${entries.length} entrada(s) gerada(s) para o dia.`,
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
    await recordSyncRun({
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
