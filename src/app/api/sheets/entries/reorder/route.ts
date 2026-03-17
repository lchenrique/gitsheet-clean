import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { moveSheetEntry } from "@/lib/sheet-store";

type ReorderBody = {
  entryId?: string;
  direction?: "up" | "down";
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as ReorderBody;
  if (!body.entryId || !body.direction) {
    return NextResponse.json({ error: "Missing entryId or direction" }, { status: 400 });
  }

  const result = await moveSheetEntry(session.login, body.entryId, body.direction);
  if (!result) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...result });
}
