import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { monthlySheets, sheetEntries, syncConfigs, syncRuns } from "@/lib/schema";

declare global {
  // eslint-disable-next-line no-var
  var __gitsheetSqlite: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __gitsheetDrizzle: ReturnType<typeof drizzle> | undefined;
}

function initSqlite() {
  const dataDir = path.join(process.cwd(), ".data");
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "gitsheet.sqlite");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");

  return sqlite;
}

function ensureSchema() {
  const db = getDb();

  db.run(sql`
    CREATE TABLE IF NOT EXISTS ${syncConfigs} (
      user_id text PRIMARY KEY NOT NULL,
      repos_json text NOT NULL,
      include_saturday integer DEFAULT 0 NOT NULL,
      include_sunday integer DEFAULT 0 NOT NULL,
      telegram_reminder_enabled integer DEFAULT 0 NOT NULL,
      first_block_start text DEFAULT '09:00' NOT NULL,
      first_block_end text DEFAULT '13:00' NOT NULL,
      second_block_start text DEFAULT '14:00' NOT NULL,
      second_block_end text DEFAULT '18:00' NOT NULL,
      initial_month text NOT NULL,
      bootstrap_start_date text,
      bootstrap_end_date text,
      last_successful_sync_date text,
      status text DEFAULT 'active' NOT NULL,
      github_pat text,
      github_access_token text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    )
  `);

  try {
    db.run(sql`ALTER TABLE ${syncConfigs} ADD COLUMN bootstrap_start_date text`);
  } catch {}

  try {
    db.run(sql`ALTER TABLE ${syncConfigs} ADD COLUMN bootstrap_end_date text`);
  } catch {}

  try {
    db.run(sql`ALTER TABLE ${syncConfigs} ADD COLUMN telegram_reminder_enabled integer DEFAULT 0 NOT NULL`);
  } catch {}

  try {
    db.run(sql`ALTER TABLE ${syncConfigs} ADD COLUMN first_block_start text DEFAULT '09:00' NOT NULL`);
  } catch {}

  try {
    db.run(sql`ALTER TABLE ${syncConfigs} ADD COLUMN first_block_end text DEFAULT '13:00' NOT NULL`);
  } catch {}

  try {
    db.run(sql`ALTER TABLE ${syncConfigs} ADD COLUMN second_block_start text DEFAULT '14:00' NOT NULL`);
  } catch {}

  try {
    db.run(sql`ALTER TABLE ${syncConfigs} ADD COLUMN second_block_end text DEFAULT '18:00' NOT NULL`);
  } catch {}

  db.run(sql`
    CREATE TABLE IF NOT EXISTS ${monthlySheets} (
      user_id text NOT NULL,
      month_key text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      PRIMARY KEY(user_id, month_key)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS ${sheetEntries} (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      month_key text NOT NULL,
      entry_date text NOT NULL,
      project text NOT NULL,
      description text NOT NULL,
      start_time text NOT NULL,
      end_time text NOT NULL,
      status text NOT NULL,
      source text NOT NULL,
      generation_key text NOT NULL,
      sync_key text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS ${syncRuns} (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      run_date text NOT NULL,
      trigger text NOT NULL,
      status text NOT NULL,
      reason text NOT NULL,
      message text,
      created_at text NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sheet_entries_user_month ON ${sheetEntries} (user_id, month_key, entry_date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sheet_entries_user_date ON ${sheetEntries} (user_id, entry_date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sync_runs_user_created ON ${syncRuns} (user_id, created_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sync_runs_user_date ON ${syncRuns} (user_id, run_date)`);
}

export function getSqlite() {
  if (!globalThis.__gitsheetSqlite) {
    globalThis.__gitsheetSqlite = initSqlite();
  }

  return globalThis.__gitsheetSqlite;
}

export function getDb() {
  if (!globalThis.__gitsheetDrizzle) {
    globalThis.__gitsheetDrizzle = drizzle(getSqlite());
    ensureSchema();
  }

  return globalThis.__gitsheetDrizzle;
}
