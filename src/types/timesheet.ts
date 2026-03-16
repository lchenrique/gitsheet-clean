export interface Repository {
  id: string;
  name: string;
  fullName: string;
  owner: string;
  isOrg: boolean;
  selected: boolean;
  defaultBranch: string;
  selectedBranch: string;
  branches?: string[];
}

export interface Commit {
  sha: string;
  message: string;
  repo: string;
  date: string;
  branch?: string;
}

export interface TimesheetEntry {
  id: string;
  project: string;
  date: string;
  description: string;
  startTime: string;
  endTime: string;
}

export interface TimeWindow {
  start: string;
  end: string;
}

export type SheetEntryStatus = "draft" | "approved" | "exported";
export type SheetEntrySource = "ai" | "manual" | "regenerated";

export interface SheetEntryRecord extends TimesheetEntry {
  sheetMonth: string;
  status: SheetEntryStatus;
  source: SheetEntrySource;
  generationKey: string;
  syncKey: string;
  createdAt: string;
  updatedAt: string;
  isNewToday?: boolean;
}

export interface SyncConfigRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  selectedBranch: string;
}

export interface SyncConfigRecord {
  userId: string;
  repos: SyncConfigRepo[];
  includeSaturday: boolean;
  includeSunday: boolean;
  telegramReminderEnabled: boolean;
  firstBlockStart: string;
  firstBlockEnd: string;
  secondBlockStart: string;
  secondBlockEnd: string;
  initialMonth: string;
  bootstrapStartDate?: string;
  bootstrapEndDate?: string;
  lastSuccessfulSyncDate?: string;
  status: "active" | "disabled";
  githubPat?: string;
  githubAccessToken?: string;
  createdAt: string;
  updatedAt: string;
}

export type SyncRunTrigger = "ui" | "worker";
export type SyncRunStatus = "success" | "skipped" | "error";

export interface SyncRunRecord {
  id: string;
  userId: string;
  runDate: string;
  trigger: SyncRunTrigger;
  status: SyncRunStatus;
  reason: string;
  message?: string;
  createdAt: string;
}

export interface SyncStatusSummary {
  lastRun?: SyncRunRecord;
  lastError?: SyncRunRecord;
}

export interface MonthlySheetSummary {
  month: string;
  status: "active" | "archived";
  totalEntries: number;
  pendingEntries: number;
}

export interface DayDraft {
  id: string;
  date: string;
  status: SheetEntryStatus;
  commits: Commit[];
  entries: TimesheetEntry[];
}
