import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSyncConfig, getSyncStatusSummary } from "@/lib/sheet-store";
import { isTelegramConfigured } from "@/lib/telegram";

export async function GET() {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getSyncConfig(session.login);
  if (!config) {
    return NextResponse.json({ config: null, syncStatus: null, telegramConfigured: isTelegramConfigured() });
  }

  const { githubPat: _githubPat, githubAccessToken: _githubAccessToken, ...safeConfig } = config;
  return NextResponse.json({
    config: safeConfig,
    syncStatus: getSyncStatusSummary(session.login),
    telegramConfigured: isTelegramConfigured(),
  });
}
