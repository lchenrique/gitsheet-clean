import { NextRequest, NextResponse } from "next/server";
import {
  buildTimeWindows,
  filterRelevantCommits,
  groupCommitsByDay,
  normalizeCommitMessage,
  splitRepoName,
} from "@/lib/generateDayDrafts";
import { Commit, DayDraft, TimesheetEntry, TimeWindow } from "@/types/timesheet";

type DraftMode = "ai";
type AIProvider = "pollinations" | "openai";

interface DraftRequest {
  commits: Commit[];
  startDate?: string;
  endDate?: string;
  includeSaturday?: boolean;
  includeSunday?: boolean;
  firstBlockStart?: string;
  firstBlockEnd?: string;
  secondBlockStart?: string;
  secondBlockEnd?: string;
  timeWindows?: TimeWindow[];
}

interface DayDraftResponse {
  drafts: DayDraft[];
  mode: DraftMode;
  warning?: string;
}

interface AiEntry {
  project: string;
  startTime: string;
  endTime: string;
  description: string;
}

interface AiDraftPayload {
  entries: AiEntry[];
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

function getDatesInRange(startDate?: string, endDate?: string, includeSaturday = false, includeSunday = false) {
  if (!startDate || !endDate) {
    return [];
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const dayOfWeek = cursor.getDay();
    const includeDate = (dayOfWeek === 6 && includeSaturday) || (dayOfWeek === 0 && includeSunday) || (dayOfWeek >= 1 && dayOfWeek <= 5);

    if (includeDate) {
      dates.push(cursor.toISOString().slice(0, 10));
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function distributeCommitsAcrossDates(commits: Commit[], targetDates: string[]) {
  const relevantCommits = filterRelevantCommits(commits);
  const buckets: Record<string, Commit[]> = Object.fromEntries(targetDates.map((date) => [date, [] as Commit[]]));

  if (!relevantCommits.length || !targetDates.length) {
    return buckets;
  }

  const commitCount = relevantCommits.length;
  const dateCount = targetDates.length;

  if (commitCount >= dateCount) {
    targetDates.forEach((date, index) => {
      const startIndex = Math.floor((index * commitCount) / dateCount);
      const endIndex = Math.floor(((index + 1) * commitCount) / dateCount);
      buckets[date] = relevantCommits.slice(startIndex, Math.max(startIndex + 1, endIndex));
    });

    return buckets;
  }

  targetDates.forEach((date, index) => {
    const commitIndex = Math.min(Math.floor((index * commitCount) / dateCount), commitCount - 1);
    buckets[date] = [relevantCommits[commitIndex]];
  });

  return buckets;
}

function getAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  return provider === "openai" ? "openai" : "pollinations";
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

function getSystemPrompt(timeWindows: readonly TimeWindow[]) {
  return [
    "Voce gera rascunhos de timesheet em portugues do Brasil.",
    "Use apenas evidencias reais dos commits.",
    "Nao invente atividade.",
    "Os commits podem ter sido redistribuidos ao longo do periodo selecionado para preencher os dias do timesheet.",
    "Se a data alvo nao tiver commit exatamente naquele dia, use os commits atribuidos a ela como evidencia de trabalho continuado no periodo.",
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

function validateAiEntries(entries: AiEntry[], date: string, dayCommits: Commit[], timeWindows: readonly TimeWindow[]) {
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

function parseJsonContent(content: unknown) {
  if (typeof content === "string") {
    return JSON.parse(content) as AiDraftPayload;
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

    return JSON.parse(text) as AiDraftPayload;
  }

  throw new Error("O provedor de IA nao retornou conteudo em texto.");
}

async function generateEntriesWithOpenAI(date: string, dayCommits: Commit[], timeWindows: readonly TimeWindow[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { entries: null, warning: "OPENAI_API_KEY nao configurada." };
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
        json_schema: {
          name: "timesheet_day_draft",
          schema: getAiResponseSchema(timeWindows),
        },
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

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  const parsed = parseJsonContent(data.choices?.[0]?.message?.content);
  return { entries: validateAiEntries(parsed.entries, date, dayCommits, timeWindows), warning: undefined };
}

async function generateEntriesWithPollinations(date: string, dayCommits: Commit[], timeWindows: readonly TimeWindow[]) {
  const endpoint = process.env.POLLINATIONS_API_URL || "https://gen.pollinations.ai/v1/chat/completions";
  const apiKey = process.env.POLLINATIONS_API_KEY?.trim();

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
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
        json_schema: {
          name: "timesheet_day_draft",
          schema: getAiResponseSchema(timeWindows),
        },
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

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  const parsed = parseJsonContent(data.choices?.[0]?.message?.content);
  return { entries: validateAiEntries(parsed.entries, date, dayCommits, timeWindows), warning: undefined };
}

async function generateEntriesWithProvider(date: string, dayCommits: Commit[], timeWindows: readonly TimeWindow[]) {
  const provider = getAIProvider();

  if (provider === "openai") {
    return generateEntriesWithOpenAI(date, dayCommits, timeWindows);
  }

  return generateEntriesWithPollinations(date, dayCommits, timeWindows);
}

export async function POST(req: NextRequest) {
  const {
    commits,
    startDate,
    endDate,
    includeSaturday,
    includeSunday,
    firstBlockStart,
    firstBlockEnd,
    secondBlockStart,
    secondBlockEnd,
    timeWindows,
  } = (await req.json()) as DraftRequest;

  if (!commits?.length) {
    return NextResponse.json<DayDraftResponse>({ drafts: [], mode: "ai" });
  }

  try {
    const selectedTimeWindows = buildTimeWindows({
      firstBlockStart,
      firstBlockEnd,
      secondBlockStart,
      secondBlockEnd,
      timeWindows,
    });
    const requestedDates = getDatesInRange(startDate, endDate, includeSaturday, includeSunday);
    const hasExplicitRange = Boolean(startDate && endDate);
    const commitsByDay = hasExplicitRange
      ? distributeCommitsAcrossDates(commits, requestedDates)
      : groupCommitsByDay(commits);

    const drafts = await Promise.all(
      Object.entries(commitsByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(async ([date, dayCommits]) => {
          if (!dayCommits.length) {
            return null;
          }

          const result = await generateEntriesWithProvider(date, dayCommits, selectedTimeWindows);
          if (!result.entries?.length) {
            const detail = result.warning ? ` Detalhe: ${result.warning}` : "";
            throw new Error(`A IA nao conseguiu gerar um resumo valido para ${date}.${detail}`);
          }

          return {
            id: date,
            date,
            status: "draft" as const,
            commits: dayCommits,
            entries: result.entries,
          };
        }),
    );

    return NextResponse.json<DayDraftResponse>({
      drafts: drafts.filter(Boolean) as DayDraft[],
      mode: "ai",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar resumos com IA.";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
