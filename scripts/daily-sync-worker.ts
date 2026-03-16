import { syncAllActiveUsersForDate } from "../src/lib/daily-sync";

const DAILY_SYNC_HOUR = Number(process.env.DAILY_SYNC_HOUR || 18);
const DAILY_SYNC_MINUTE = Number(process.env.DAILY_SYNC_MINUTE || 0);
const CHECK_INTERVAL_MS = Number(process.env.DAILY_SYNC_CHECK_INTERVAL_MS || 60_000);

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function shouldRunNow(now: Date) {
  return now.getHours() === DAILY_SYNC_HOUR && now.getMinutes() === DAILY_SYNC_MINUTE;
}

async function runDailySync(date: string) {
  const results = await syncAllActiveUsersForDate(date);
  const synced = results.filter((result) => result.synced).length;
  const failures = results.filter((result) => result.reason === "error").length;
  const skipped = results.length - synced - failures;

  console.log(
    `[daily-sync] ${date} processed=${results.length} synced=${synced} skipped=${skipped} failures=${failures}`,
  );

  for (const result of results) {
    if ("error" in result) {
      console.error(`[daily-sync] user=${result.userId} date=${result.date} error=${result.error}`);
    }
  }
}

async function runOnce() {
  const date = process.env.DAILY_SYNC_DATE || getTodayDate();
  await runDailySync(date);
}

async function runWorkerLoop() {
  let lastRunDate = "";

  console.log(
    `[daily-sync] worker started, target=${String(DAILY_SYNC_HOUR).padStart(2, "0")}:${String(DAILY_SYNC_MINUTE).padStart(2, "0")}`,
  );

  for (;;) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);

    if (shouldRunNow(now) && lastRunDate !== date) {
      lastRunDate = date;
      try {
        await runDailySync(date);
      } catch (error) {
        console.error(`[daily-sync] fatal run error: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
}

const runAsOnce = process.argv.includes("--run-once");

if (runAsOnce) {
  await runOnce();
  process.exit(0);
}

await runWorkerLoop();
