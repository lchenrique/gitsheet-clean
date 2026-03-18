import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentSyncDate, syncAllActiveUsersForDate, syncTodayForUser } from "@/lib/daily-sync";

export const runtime = "nodejs";

function isAuthorizedCronRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedDate = request.nextUrl.searchParams.get("date");
  const date = requestedDate || getCurrentSyncDate();

  try {
    const results = await syncAllActiveUsersForDate(date);
    const synced = results.filter((result) => result.synced).length;
    const failures = results.filter((result) => result.reason === "error").length;

    return NextResponse.json({
      ok: true,
      trigger: "cron",
      date,
      processed: results.length,
      synced,
      failures,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao executar o sync diário." },
      { status: 500 },
    );
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncTodayForUser(session.login);
    const synced = results.filter((result) => result.synced).length;
    const failures = results.filter((result) => result.reason === "error").length;

    return NextResponse.json({
      ok: true,
      trigger: "ui",
      processed: results.length,
      synced,
      failures,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao sincronizar o dia atual." },
      { status: 500 },
    );
  }
}
