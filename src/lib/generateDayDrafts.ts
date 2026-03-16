import { format, parseISO } from "date-fns";
import { Commit, DayDraft, TimesheetEntry, TimeWindow } from "@/types/timesheet";

export const DEFAULT_TIME_WINDOWS: [TimeWindow, TimeWindow] = [
  { start: "09:00", end: "13:00" },
  { start: "14:00", end: "18:00" },
];

export function normalizeTime(value: string, fallback: string) {
  const normalized = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) {
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) {
    return fallback;
  }

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function buildTimeWindows(input?: Partial<{
  firstBlockStart: string;
  firstBlockEnd: string;
  secondBlockStart: string;
  secondBlockEnd: string;
  timeWindows: TimeWindow[];
}>) {
  const explicitWindows = input?.timeWindows?.slice(0, 2);
  const windows = explicitWindows?.length === 2
    ? explicitWindows
    : [
        {
          start: input?.firstBlockStart ?? DEFAULT_TIME_WINDOWS[0].start,
          end: input?.firstBlockEnd ?? DEFAULT_TIME_WINDOWS[0].end,
        },
        {
          start: input?.secondBlockStart ?? DEFAULT_TIME_WINDOWS[1].start,
          end: input?.secondBlockEnd ?? DEFAULT_TIME_WINDOWS[1].end,
        },
      ];

  const normalizedWindows = windows.map((window, index) => ({
    start: normalizeTime(window.start, DEFAULT_TIME_WINDOWS[index].start),
    end: normalizeTime(window.end, DEFAULT_TIME_WINDOWS[index].end),
  }));

  const first = normalizedWindows[0];
  const second = normalizedWindows[1];

  if (
    toMinutes(first.start) >= toMinutes(first.end) ||
    toMinutes(second.start) >= toMinutes(second.end) ||
    toMinutes(first.end) > toMinutes(second.start)
  ) {
    return DEFAULT_TIME_WINDOWS.map((window) => ({ ...window })) as [TimeWindow, TimeWindow];
  }

  return normalizedWindows as [TimeWindow, TimeWindow];
}

export function isMergeCommit(message: string) {
  return /^merge (pull request|branch)/i.test(message.trim());
}

function formatScope(scope: string) {
  return scope.replace(/[-_/]+/g, " ").trim();
}

export function splitRepoName(repoFullName: string) {
  return repoFullName.split("/")[1] || repoFullName;
}

export function normalizeCommitMessage(message: string) {
  const firstLine = message.split("\n")[0].trim();
  const conventionalMatch = firstLine.match(
    /^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)(\(([^)]+)\))?!?:\s*(.+)$/i,
  );

  if (!conventionalMatch) {
    return firstLine;
  }

  const [, , , scope, description] = conventionalMatch;
  if (!scope) {
    return description.trim();
  }

  return `${formatScope(scope)}: ${description.trim()}`;
}

export function filterRelevantCommits(commits: Commit[]) {
  return commits.filter((commit) => !isMergeCommit(commit.message)).sort((a, b) => a.date.localeCompare(b.date));
}

function getTimeWindow(date: string, timeWindows: readonly TimeWindow[]) {
  const hour = parseISO(date).getHours();
  return hour < 13 ? timeWindows[0] : timeWindows[1];
}

function buildDescription(commits: Commit[]) {
  return [...new Set(commits.map((commit) => normalizeCommitMessage(commit.message)).filter(Boolean))].join("; ");
}

export function groupCommitsByDay(commits: Commit[]) {
  const relevantCommits = filterRelevantCommits(commits);
  const byDay: Record<string, Commit[]> = {};

  relevantCommits.forEach((commit) => {
    const day = format(parseISO(commit.date), "yyyy-MM-dd");
    if (!byDay[day]) {
      byDay[day] = [];
    }

    byDay[day].push(commit);
  });

  return byDay;
}

export function generateDayDrafts(commits: Commit[], timeWindows = DEFAULT_TIME_WINDOWS): DayDraft[] {
  return Object.entries(groupCommitsByDay(commits))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayCommits]) => {
      const groupedEntries = new Map<string, Commit[]>();

      dayCommits.forEach((commit) => {
        const repoName = splitRepoName(commit.repo);
        const window = getTimeWindow(commit.date, timeWindows);
        const key = `${repoName}::${window.start}-${window.end}`;

        if (!groupedEntries.has(key)) {
          groupedEntries.set(key, []);
        }

        groupedEntries.get(key)?.push(commit);
      });

      const entries: TimesheetEntry[] = [...groupedEntries.entries()]
        .map(([key, groupCommits], index) => {
          const [project, window] = key.split("::");
          const [startTime, endTime] = window.split("-");

          return {
            id: `${date}-${index + 1}`,
            project,
            date,
            description: buildDescription(groupCommits),
            startTime,
            endTime,
          };
        })
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      return {
        id: date,
        date,
        status: "draft" as const,
        commits: dayCommits,
        entries,
      };
    })
    .filter((draft) => draft.entries.length > 0);
}
