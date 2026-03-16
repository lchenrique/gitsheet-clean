import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSheetEntries } from "@/lib/sheet-store";

export async function GET(_: NextRequest, { params }: { params: { month: string } }) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  return NextResponse.json({
    month: params.month,
    entries: await getSheetEntries(session.login, params.month, today),
  });
}
