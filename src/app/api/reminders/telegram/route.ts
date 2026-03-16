import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSyncConfig, updateTelegramReminder } from "@/lib/sheet-store";
import { isTelegramConfigured } from "@/lib/telegram";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getSyncConfig(session.login);
  if (!config) {
    return NextResponse.json({ error: "Configuração não encontrada." }, { status: 404 });
  }

  const body = (await request.json()) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  if (body.enabled && !isTelegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram não configurado no ambiente. Defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID." },
      { status: 400 },
    );
  }

  updateTelegramReminder(session.login, body.enabled);
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
