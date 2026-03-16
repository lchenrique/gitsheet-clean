function getTelegramConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  return {
    botToken,
    chatId,
    enabled: Boolean(botToken && chatId),
  };
}

export function isTelegramConfigured() {
  return getTelegramConfig().enabled;
}

export async function sendTelegramReminder(message: string) {
  const { botToken, chatId, enabled } = getTelegramConfig();
  if (!enabled || !botToken || !chatId) {
    return { sent: false as const, reason: "missing-config" as const };
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram retornou ${response.status}: ${errorText}`);
  }

  return { sent: true as const };
}
