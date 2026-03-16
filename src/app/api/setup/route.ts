import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { persistInitialDrafts, upsertSyncConfig } from "@/lib/sheet-store";
import { DayDraft, SyncConfigRepo } from "@/types/timesheet";

interface SetupRequest {
  repos: SyncConfigRepo[];
  includeSaturday: boolean;
  includeSunday: boolean;
  firstBlockStart: string;
  firstBlockEnd: string;
  secondBlockStart: string;
  secondBlockEnd: string;
  startDate: string;
  endDate: string;
  drafts: DayDraft[];
  githubPat?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as SetupRequest;
  const initialMonth = body.startDate.slice(0, 7);

  upsertSyncConfig({
    userId: session.login,
    repos: body.repos,
    includeSaturday: body.includeSaturday,
    includeSunday: body.includeSunday,
    firstBlockStart: body.firstBlockStart,
    firstBlockEnd: body.firstBlockEnd,
    secondBlockStart: body.secondBlockStart,
    secondBlockEnd: body.secondBlockEnd,
    initialMonth,
    bootstrapStartDate: body.startDate,
    bootstrapEndDate: body.endDate,
    lastSuccessfulSyncDate: body.endDate,
    status: "active",
    githubPat: body.githubPat?.trim() || undefined,
    githubAccessToken: session.accessToken,
  });

  persistInitialDrafts(session.login, body.drafts);

  return NextResponse.json({ ok: true });
}
