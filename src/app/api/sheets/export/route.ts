import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { markMonthExported } from "@/lib/sheet-store";

interface ExportRequest {
  month: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ExportRequest;
  markMonthExported(session.login, body.month);
  return NextResponse.json({ ok: true });
}
