// Vercel serverless entrypoint for Telegram webhooks. Not used locally —
// local dev / always-on hosts use long polling instead (src/local.ts).
import { webhookCallback } from "grammy";
import { bot } from "../src/bot.ts";

const handleUpdate = webhookCallback(bot, "http", {
  // The idea -> context -> draft -> score pipeline is several sequential LLM
  // calls and can run well past grammy's 10s default before Vercel's own
  // function timeout (see vercel.json) cuts it off.
  timeoutMilliseconds: 55_000,
  onTimeout: "return",
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
});

export default async function handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 200;
    res.end("ok");
    return;
  }
  try {
    await handleUpdate(req, res);
  } catch (err) {
    console.error("webhook error", err);
    if (!res.writableEnded) {
      res.statusCode = 200; // acknowledge to Telegram regardless, so it doesn't retry forever
      res.end("ok");
    }
  }
}
