import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createManualSheetEntry } from "@/lib/sheet-store";

type CreateEntryBody = {
  month: string;
  date: string;
  project?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as CreateEntryBody;
  if (!body.month || !body.date) {
    return NextResponse.json({ error: "Month and date are required" }, { status: 400 });
  }

  const entry = await createManualSheetEntry(session.login, body);
  return NextResponse.json({ entry });
}
