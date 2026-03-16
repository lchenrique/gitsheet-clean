import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resetUserWorkspace } from "@/lib/sheet-store";

export async function POST() {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await resetUserWorkspace(session.login);
  return NextResponse.json({ ok: true });
}
