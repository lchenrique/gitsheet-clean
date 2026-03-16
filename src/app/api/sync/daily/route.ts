import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncTodayForUser } from "@/lib/daily-sync";

export async function POST() {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncTodayForUser(session.login);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao sincronizar o dia atual." },
      { status: 500 },
    );
  }
}
