# GitSheet Clean

Projeto novo e limpo em Next.js para substituir a base antiga do GitSheet.

## Rodando

```bash
npm install
npm run dev
```

## Variaveis

Use o arquivo `.env.local.example` como base para criar seu `.env.local`.

## Deploy na Vercel

Variáveis mínimas para produção:

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `CRON_SECRET`

Variáveis opcionais, dependendo do uso:

- `AI_PROVIDER`
- `POLLINATIONS_API_URL`
- `POLLINATIONS_MODEL`
- `POLLINATIONS_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Observações:

- O projeto já está configurado com cron diário em `vercel.json`.
- A rota de cron é `GET /api/sync/daily` e valida `Authorization: Bearer ${CRON_SECRET}`.
- O agendamento da Vercel usa UTC. O valor atual `0 21 * * *` corresponde a `18:00` em São Paulo quando o offset é `UTC-3`.
- Em `Preview`, prefira usar outro banco/branch do Neon em vez do mesmo banco de `Production`.
