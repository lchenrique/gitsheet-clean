import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function dumpSqlite(sqlitePath) {
  const pythonCode = `
import json
import sqlite3
import sys

conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
cur = conn.cursor()

tables = ["sync_configs", "monthly_sheets", "sheet_entries", "sync_runs"]
payload = {}

for table in tables:
    cur.execute(f"SELECT * FROM {table}")
    payload[table] = [dict(row) for row in cur.fetchall()]

print(json.dumps(payload, ensure_ascii=False))
`;

  const result = spawnSync("python", ["-c", pythonCode, sqlitePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "Falha ao ler o SQLite com Python.");
  }

  return JSON.parse(result.stdout);
}

async function getRemoteCounts(sql) {
  const syncConfigs = await sql`SELECT COUNT(*)::int AS count FROM sync_configs`;
  const monthlySheets = await sql`SELECT COUNT(*)::int AS count FROM monthly_sheets`;
  const sheetEntries = await sql`SELECT COUNT(*)::int AS count FROM sheet_entries`;
  const syncRuns = await sql`SELECT COUNT(*)::int AS count FROM sync_runs`;

  return {
    sync_configs: syncConfigs[0].count,
    monthly_sheets: monthlySheets[0].count,
    sheet_entries: sheetEntries[0].count,
    sync_runs: syncRuns[0].count,
  };
}

async function main() {
  const sqlitePath = path.resolve(getArgValue("--sqlite") || ".data/gitsheet.sqlite");
  const force = hasFlag("--force");
  const databaseUrl = process.env.DATABASE_URL;

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite não encontrado em ${sqlitePath}`);
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL não encontrado no ambiente.");
  }

  const source = dumpSqlite(sqlitePath);
  const sourceCounts = Object.fromEntries(Object.entries(source).map(([table, rows]) => [table, rows.length]));
  const sql = neon(databaseUrl);
  const targetCounts = await getRemoteCounts(sql);
  const targetHasData = Object.values(targetCounts).some((count) => count > 0);

  console.log("SQLite:", sourceCounts);
  console.log("Neon antes:", targetCounts);

  if (targetHasData && !force) {
    throw new Error("O Neon já possui dados. Use --force se quiser mesclar com upsert.");
  }

  await sql`BEGIN`;

  try {
    for (const row of source.sync_configs) {
      await sql.query(
        `INSERT INTO sync_configs (
          user_id, repos_json, include_saturday, include_sunday, telegram_reminder_enabled,
          first_block_start, first_block_end, second_block_start, second_block_end,
          initial_month, bootstrap_start_date, bootstrap_end_date, last_successful_sync_date,
          status, github_pat, github_access_token, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18
        )
        ON CONFLICT (user_id) DO UPDATE SET
          repos_json = EXCLUDED.repos_json,
          include_saturday = EXCLUDED.include_saturday,
          include_sunday = EXCLUDED.include_sunday,
          telegram_reminder_enabled = EXCLUDED.telegram_reminder_enabled,
          first_block_start = EXCLUDED.first_block_start,
          first_block_end = EXCLUDED.first_block_end,
          second_block_start = EXCLUDED.second_block_start,
          second_block_end = EXCLUDED.second_block_end,
          initial_month = EXCLUDED.initial_month,
          bootstrap_start_date = EXCLUDED.bootstrap_start_date,
          bootstrap_end_date = EXCLUDED.bootstrap_end_date,
          last_successful_sync_date = EXCLUDED.last_successful_sync_date,
          status = EXCLUDED.status,
          github_pat = EXCLUDED.github_pat,
          github_access_token = EXCLUDED.github_access_token,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at`,
        [
          row.user_id,
          row.repos_json,
          Boolean(row.include_saturday),
          Boolean(row.include_sunday),
          Boolean(row.telegram_reminder_enabled),
          row.first_block_start,
          row.first_block_end,
          row.second_block_start,
          row.second_block_end,
          row.initial_month,
          row.bootstrap_start_date,
          row.bootstrap_end_date,
          row.last_successful_sync_date,
          row.status,
          row.github_pat,
          row.github_access_token,
          row.created_at,
          row.updated_at,
        ],
      );
    }

    for (const row of source.monthly_sheets) {
      await sql.query(
        `INSERT INTO monthly_sheets (user_id, month_key, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, month_key) DO UPDATE SET
           status = EXCLUDED.status,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [row.user_id, row.month_key, row.status, row.created_at, row.updated_at],
      );
    }

    for (const row of source.sheet_entries) {
      await sql.query(
        `INSERT INTO sheet_entries (
          id, user_id, month_key, entry_date, project, description,
          start_time, end_time, status, source, generation_key, sync_key, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          month_key = EXCLUDED.month_key,
          entry_date = EXCLUDED.entry_date,
          project = EXCLUDED.project,
          description = EXCLUDED.description,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          status = EXCLUDED.status,
          source = EXCLUDED.source,
          generation_key = EXCLUDED.generation_key,
          sync_key = EXCLUDED.sync_key,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.user_id,
          row.month_key,
          row.entry_date,
          row.project,
          row.description,
          row.start_time,
          row.end_time,
          row.status,
          row.source,
          row.generation_key,
          row.sync_key,
          row.created_at,
          row.updated_at,
        ],
      );
    }

    for (const row of source.sync_runs) {
      await sql.query(
        `INSERT INTO sync_runs (id, user_id, run_date, trigger, status, reason, message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           run_date = EXCLUDED.run_date,
           trigger = EXCLUDED.trigger,
           status = EXCLUDED.status,
           reason = EXCLUDED.reason,
           message = EXCLUDED.message,
           created_at = EXCLUDED.created_at`,
        [row.id, row.user_id, row.run_date, row.trigger, row.status, row.reason, row.message, row.created_at],
      );
    }

    await sql`COMMIT`;
  } catch (error) {
    await sql`ROLLBACK`;
    throw error;
  }

  const finalCounts = await getRemoteCounts(sql);
  console.log("Neon depois:", finalCounts);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
