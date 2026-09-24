// Long-polling entrypoint: local dev, or any always-on host (Railway, Fly.io, a Raspberry Pi).
// Not used on Vercel — there the bot runs as a webhook (api/telegram.ts) and
// the weekly reminder runs as a Cron job (api/cron.ts) instead of setInterval.
import { bot, checkReminders } from "./bot.ts";
import { config } from "./config.ts";

try {
  await bot.api.setMyCommands([
    { command: "backlog", description: "Saved ideas, best first" },
    { command: "ready", description: "Approved posts ready to publish" },
    { command: "develop", description: "Develop an idea: /develop <id>" },
    { command: "idea", description: "Show an idea: /idea <id>" },
    { command: "help", description: "How this works" },
  ]);
} catch (err) {
  console.error("Couldn't connect to Telegram. Check TELEGRAM_BOT_TOKEN in .env.\n", err instanceof Error ? err.message : err);
  process.exit(1);
}

setInterval(checkReminders, 60_000);
console.log(`Bot running (triage/research: ${config.geminiModel}, drafting: ${config.geminiDraftModel}). Press Ctrl+C to stop.`);
bot.start();
