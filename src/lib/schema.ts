import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const syncConfigs = sqliteTable("sync_configs", {
  userId: text("user_id").primaryKey(),
  reposJson: text("repos_json").notNull(),
  includeSaturday: integer("include_saturday", { mode: "boolean" }).notNull().default(false),
  includeSunday: integer("include_sunday", { mode: "boolean" }).notNull().default(false),
  telegramReminderEnabled: integer("telegram_reminder_enabled", { mode: "boolean" }).notNull().default(false),
  firstBlockStart: text("first_block_start").notNull().default("09:00"),
  firstBlockEnd: text("first_block_end").notNull().default("13:00"),
  secondBlockStart: text("second_block_start").notNull().default("14:00"),
  secondBlockEnd: text("second_block_end").notNull().default("18:00"),
  initialMonth: text("initial_month").notNull(),
  bootstrapStartDate: text("bootstrap_start_date"),
  bootstrapEndDate: text("bootstrap_end_date"),
  lastSuccessfulSyncDate: text("last_successful_sync_date"),
  status: text("status").notNull().default("active"),
  githubPat: text("github_pat"),
  githubAccessToken: text("github_access_token"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const monthlySheets = sqliteTable(
  "monthly_sheets",
  {
    userId: text("user_id").notNull(),
    monthKey: text("month_key").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.monthKey] }),
  }),
);

export const sheetEntries = sqliteTable(
  "sheet_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    monthKey: text("month_key").notNull(),
    entryDate: text("entry_date").notNull(),
    project: text("project").notNull(),
    description: text("description").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    generationKey: text("generation_key").notNull(),
    syncKey: text("sync_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    userMonthIdx: index("idx_sheet_entries_user_month").on(table.userId, table.monthKey, table.entryDate),
    userDateIdx: index("idx_sheet_entries_user_date").on(table.userId, table.entryDate),
  }),
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    runDate: text("run_date").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    message: text("message"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    userCreatedIdx: index("idx_sync_runs_user_created").on(table.userId, table.createdAt),
    userDateIdx: index("idx_sync_runs_user_date").on(table.userId, table.runDate),
  }),
);
