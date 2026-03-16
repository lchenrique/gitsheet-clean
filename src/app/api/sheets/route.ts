import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listMonthlySheets } from "@/lib/sheet-store";

export async function GET() {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ sheets: await listMonthlySheets(session.login) });
}
