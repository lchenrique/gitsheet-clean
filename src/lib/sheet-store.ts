import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { monthlySheets, sheetEntries, syncConfigs, syncRuns } from "@/lib/schema";
import {
  DayDraft,
  MonthlySheetSummary,
  SheetEntryRecord,
  SheetEntrySource,
  SheetEntryStatus,
  SyncConfigRecord,
  SyncConfigRepo,
  SyncRunRecord,
  SyncRunStatus,
  SyncRunTrigger,
  SyncStatusSummary,
  TimesheetEntry,
} from "@/types/timesheet";

function nowIso() {
  return new Date().toISOString();
}

function toMonthKey(date: string) {
  return date.slice(0, 7);
}

type UpsertSyncConfigInput = {
  userId: string;
  repos: SyncConfigRepo[];
  includeSaturday: boolean;
  includeSunday: boolean;
  telegramReminderEnabled?: boolean;
  firstBlockStart?: string;
  firstBlockEnd?: string;
  secondBlockStart?: string;
  secondBlockEnd?: string;
  initialMonth: string;
  bootstrapStartDate?: string;
  bootstrapEndDate?: string;
  lastSuccessfulSyncDate?: string;
  status?: "active" | "disabled";
  githubPat?: string;
  githubAccessToken?: string;
};

function mapSyncConfig(row: typeof syncConfigs.$inferSelect): SyncConfigRecord {
  return {
    userId: row.userId,
    repos: JSON.parse(row.reposJson) as SyncConfigRepo[],
    includeSaturday: row.includeSaturday,
    includeSunday: row.includeSunday,
    telegramReminderEnabled: row.telegramReminderEnabled,
    firstBlockStart: row.firstBlockStart,
    firstBlockEnd: row.firstBlockEnd,
    secondBlockStart: row.secondBlockStart,
    secondBlockEnd: row.secondBlockEnd,
    initialMonth: row.initialMonth,
    bootstrapStartDate: row.bootstrapStartDate ?? undefined,
    bootstrapEndDate: row.bootstrapEndDate ?? undefined,
    lastSuccessfulSyncDate: row.lastSuccessfulSyncDate ?? undefined,
    status: row.status as "active" | "disabled",
    githubPat: row.githubPat ?? undefined,
    githubAccessToken: row.githubAccessToken ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSyncRun(row: typeof syncRuns.$inferSelect): SyncRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    runDate: row.runDate,
    trigger: row.trigger as SyncRunTrigger,
    status: row.status as SyncRunStatus,
    reason: row.reason,
    message: row.message ?? undefined,
    createdAt: row.createdAt,
  };
}

export async function getSyncConfig(userId: string): Promise<SyncConfigRecord | null> {
  const db = getDb();
  const rows = await db.select().from(syncConfigs).where(eq(syncConfigs.userId, userId)).limit(1);
  const row = rows[0];
  return row ? mapSyncConfig(row) : null;
}

export async function listActiveSyncConfigs(): Promise<SyncConfigRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(syncConfigs)
    .where(eq(syncConfigs.status, "active"));
  
  return rows.map(mapSyncConfig);
}

export async function upsertSyncConfig(config: UpsertSyncConfigInput) {
  const db = getDb();
  const current = await getSyncConfig(config.userId);
  const timestamp = nowIso();

  await db.insert(syncConfigs)
    .values({
      userId: config.userId,
      reposJson: JSON.stringify(config.repos),
      includeSaturday: config.includeSaturday,
      includeSunday: config.includeSunday,
      telegramReminderEnabled: config.telegramReminderEnabled ?? current?.telegramReminderEnabled ?? false,
      firstBlockStart: config.firstBlockStart ?? current?.firstBlockStart ?? "09:00",
      firstBlockEnd: config.firstBlockEnd ?? current?.firstBlockEnd ?? "13:00",
      secondBlockStart: config.secondBlockStart ?? current?.secondBlockStart ?? "14:00",
      secondBlockEnd: config.secondBlockEnd ?? current?.secondBlockEnd ?? "18:00",
      initialMonth: config.initialMonth,
      bootstrapStartDate: config.bootstrapStartDate ?? current?.bootstrapStartDate ?? null,
      bootstrapEndDate: config.bootstrapEndDate ?? current?.bootstrapEndDate ?? null,
      lastSuccessfulSyncDate: config.lastSuccessfulSyncDate ?? current?.lastSuccessfulSyncDate ?? null,
      status: config.status ?? current?.status ?? "active",
      githubPat: config.githubPat ?? current?.githubPat ?? null,
      githubAccessToken: config.githubAccessToken ?? current?.githubAccessToken ?? null,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: syncConfigs.userId,
      set: {
        reposJson: JSON.stringify(config.repos),
        includeSaturday: config.includeSaturday,
        includeSunday: config.includeSunday,
        telegramReminderEnabled: config.telegramReminderEnabled ?? current?.telegramReminderEnabled ?? false,
        firstBlockStart: config.firstBlockStart ?? current?.firstBlockStart ?? "09:00",
        firstBlockEnd: config.firstBlockEnd ?? current?.firstBlockEnd ?? "13:00",
        secondBlockStart: config.secondBlockStart ?? current?.secondBlockStart ?? "14:00",
        secondBlockEnd: config.secondBlockEnd ?? current?.secondBlockEnd ?? "18:00",
        initialMonth: config.initialMonth,
        bootstrapStartDate: config.bootstrapStartDate ?? current?.bootstrapStartDate ?? null,
        bootstrapEndDate: config.bootstrapEndDate ?? current?.bootstrapEndDate ?? null,
        lastSuccessfulSyncDate: config.lastSuccessfulSyncDate ?? current?.lastSuccessfulSyncDate ?? null,
        status: config.status ?? current?.status ?? "active",
        githubPat: config.githubPat ?? current?.githubPat ?? null,
        githubAccessToken: config.githubAccessToken ?? current?.githubAccessToken ?? null,
        updatedAt: timestamp,
      },
    });
}

export async function recordSyncRun(input: {
  userId: string;
  runDate: string;
  trigger: SyncRunTrigger;
  status: SyncRunStatus;
  reason: string;
  message?: string;
}) {
  const db = getDb();

  await db.insert(syncRuns)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      runDate: input.runDate,
      trigger: input.trigger,
      status: input.status,
      reason: input.reason,
      message: input.message ?? null,
      createdAt: nowIso(),
    });
}

export async function updateTelegramReminder(userId: string, enabled: boolean) {
  const current = await getSyncConfig(userId);
  if (!current) {
    return false;
  }

  await upsertSyncConfig({
    userId,
    repos: current.repos,
    includeSaturday: current.includeSaturday,
    includeSunday: current.includeSunday,
    telegramReminderEnabled: enabled,
    firstBlockStart: current.firstBlockStart,
    firstBlockEnd: current.firstBlockEnd,
    secondBlockStart: current.secondBlockStart,
    secondBlockEnd: current.secondBlockEnd,
    initialMonth: current.initialMonth,
    bootstrapStartDate: current.bootstrapStartDate,
    bootstrapEndDate: current.bootstrapEndDate,
    lastSuccessfulSyncDate: current.lastSuccessfulSyncDate,
    status: current.status,
    githubPat: current.githubPat,
    githubAccessToken: current.githubAccessToken,
  });

  return true;
}

export async function getSyncStatusSummary(userId: string): Promise<SyncStatusSummary> {
  const db = getDb();

  const lastRunRows = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.userId, userId))
    .orderBy(desc(syncRuns.createdAt))
    .limit(1);
  const lastRunRow = lastRunRows[0];

  const lastErrorRows = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.status, "error")))
    .orderBy(desc(syncRuns.createdAt))
    .limit(1);
  const lastErrorRow = lastErrorRows[0];

  return {
    lastRun: lastRunRow ? mapSyncRun(lastRunRow) : undefined,
    lastError: lastErrorRow ? mapSyncRun(lastErrorRow) : undefined,
  };
}

export async function ensureMonthlySheet(userId: string, month: string, status: "active" | "archived" = "active") {
  const db = getDb();
  const timestamp = nowIso();

  await db.insert(monthlySheets)
    .values({
      userId,
      monthKey: month,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [monthlySheets.userId, monthlySheets.monthKey],
      set: {
        status,
        updatedAt: timestamp,
      },
    });
}

export async function listMonthlySheets(userId: string): Promise<MonthlySheetSummary[]> {
  const db = getDb();

  const rows = await db
    .select({
      month: monthlySheets.monthKey,
      status: monthlySheets.status,
      totalEntries: sql<number>`count(${sheetEntries.id})`,
      pendingEntries: sql<number>`coalesce(sum(case when ${sheetEntries.status} = 'draft' then 1 else 0 end), 0)`,
    })
    .from(monthlySheets)
    .leftJoin(
      sheetEntries,
      and(eq(sheetEntries.userId, monthlySheets.userId), eq(sheetEntries.monthKey, monthlySheets.monthKey)),
    )
    .where(eq(monthlySheets.userId, userId))
    .groupBy(monthlySheets.userId, monthlySheets.monthKey, monthlySheets.status)
    .orderBy(desc(monthlySheets.monthKey));

  return rows.map((row) => ({
    month: row.month,
    status: row.status as "active" | "archived",
    totalEntries: Number(row.totalEntries ?? 0),
    pendingEntries: Number(row.pendingEntries ?? 0),
  }));
}

export async function getSheetEntries(userId: string, month: string, todayDate?: string): Promise<SheetEntryRecord[]> {
  const db = getDb();

  const rows = await db
    .select()
    .from(sheetEntries)
    .where(and(eq(sheetEntries.userId, userId), eq(sheetEntries.monthKey, month)))
    .orderBy(sheetEntries.entryDate, sheetEntries.startTime, sheetEntries.createdAt);

  return rows.map((row) => ({
    id: row.id,
    sheetMonth: row.monthKey,
    date: row.entryDate,
    project: row.project,
    description: row.description,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status as SheetEntryStatus,
    source: row.source as SheetEntrySource,
    generationKey: row.generationKey,
    syncKey: row.syncKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isNewToday: todayDate ? row.syncKey === `daily:${todayDate}` : false,
  }));
}

export async function hasEntriesForSyncKey(userId: string, syncKey: string) {
  const db = getDb();
  const rows = await db
    .select({ id: sheetEntries.id })
    .from(sheetEntries)
    .where(and(eq(sheetEntries.userId, userId), eq(sheetEntries.syncKey, syncKey)))
    .limit(1);

  return rows.length > 0;
}

async function insertEntriesForDate(
  userId: string,
  date: string,
  entries: TimesheetEntry[],
  source: SheetEntrySource,
  syncKey: string,
  generationKeyPrefix: string,
) {
  const db = getDb();
  const month = toMonthKey(date);
  const timestamp = nowIso();
  await ensureMonthlySheet(userId, month);

  await db.delete(sheetEntries)
    .where(
      and(
        eq(sheetEntries.userId, userId),
        eq(sheetEntries.entryDate, date),
        eq(sheetEntries.status, "draft"),
        inArray(sheetEntries.source, ["ai", "regenerated"]),
      ),
    );

  if (!entries.length) {
    return;
  }

  await db.insert(sheetEntries)
    .values(
      entries.map((entry, index) => ({
        id: crypto.randomUUID(),
        userId,
        monthKey: month,
        entryDate: entry.date,
        project: entry.project,
        description: entry.description,
        startTime: entry.startTime,
        endTime: entry.endTime,
        status: "draft",
        source,
        generationKey: `${generationKeyPrefix}:${date}:${index + 1}`,
        syncKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );
}

export async function persistInitialDrafts(userId: string, dayDrafts: DayDraft[]) {
  const syncKey = `initial:${nowIso()}`;
  for (const draft of dayDrafts) {
    await insertEntriesForDate(userId, draft.date, draft.entries, "ai", syncKey, "initial");
  }
}

export async function persistDailyDraft(userId: string, date: string, entries: TimesheetEntry[], source: SheetEntrySource = "ai") {
  await insertEntriesForDate(userId, date, entries, source, `daily:${date}`, "daily");
}

export async function updateSheetEntry(
  userId: string,
  entryId: string,
  patch: Partial<Pick<SheetEntryRecord, "project" | "description" | "startTime" | "endTime" | "status">>,
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(sheetEntries)
    .where(and(eq(sheetEntries.userId, userId), eq(sheetEntries.id, entryId)))
    .limit(1);
  const current = rows[0];

  if (!current) {
    return false;
  }

  await db.update(sheetEntries)
    .set({
      project: patch.project ?? current.project,
      description: patch.description ?? current.description,
      startTime: patch.startTime ?? current.startTime,
      endTime: patch.endTime ?? current.endTime,
      status: patch.status ?? (current.status as SheetEntryStatus),
      source: "manual",
      updatedAt: nowIso(),
    })
    .where(and(eq(sheetEntries.userId, userId), eq(sheetEntries.id, entryId)));

  return true;
}

export async function approveSheetEntries(userId: string, month: string, entryIds?: string[]) {
  const db = getDb();
  
  if (entryIds?.length) {
    await db.update(sheetEntries)
      .set({
        status: "approved",
        updatedAt: nowIso(),
      })
      .where(
        and(eq(sheetEntries.userId, userId), eq(sheetEntries.monthKey, month), inArray(sheetEntries.id, entryIds)),
      );
    return;
  }

  await db.update(sheetEntries)
    .set({
      status: "approved",
      updatedAt: nowIso(),
    })
    .where(and(eq(sheetEntries.userId, userId), eq(sheetEntries.monthKey, month), eq(sheetEntries.status, "draft")));
}

export async function markMonthExported(userId: string, month: string) {
  const db = getDb();
  await db.update(sheetEntries)
    .set({
      status: "exported",
      updatedAt: nowIso(),
    })
    .where(and(eq(sheetEntries.userId, userId), eq(sheetEntries.monthKey, month), inArray(sheetEntries.status, ["approved", "draft"])));
}

export async function resetUserWorkspace(userId: string) {
  const db = getDb();

  await db.delete(sheetEntries).where(eq(sheetEntries.userId, userId));
  await db.delete(monthlySheets).where(eq(monthlySheets.userId, userId));
  await db.delete(syncRuns).where(eq(syncRuns.userId, userId));
  await db.delete(syncConfigs).where(eq(syncConfigs.userId, userId));
}

