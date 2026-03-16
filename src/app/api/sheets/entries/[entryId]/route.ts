import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateSheetEntry } from "@/lib/sheet-store";
import { SheetEntryRecord } from "@/types/timesheet";

type PatchBody = Partial<Pick<SheetEntryRecord, "project" | "description" | "startTime" | "endTime" | "status">>;

export async function PATCH(req: NextRequest, { params }: { params: { entryId: string } }) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as PatchBody;
  const updated = updateSheetEntry(session.login, params.entryId, body);

  if (!updated) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
