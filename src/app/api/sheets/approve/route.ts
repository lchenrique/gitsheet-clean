import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveSheetEntries } from "@/lib/sheet-store";

interface ApproveRequest {
  month: string;
  entryIds?: string[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ApproveRequest;
  await approveSheetEntries(session.login, body.month, body.entryIds);
  return NextResponse.json({ ok: true });
}
