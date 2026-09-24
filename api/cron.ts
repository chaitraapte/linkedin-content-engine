// Vercel Cron entrypoint: replaces the setInterval reminder loop, which can't
// run on serverless. Hobby plan crons can't run more than once/day, so
// vercel.json schedules one fixed UTC time per reminder (matching REMINDERS,
// converted from local time to UTC) instead of an hourly sweep. checkReminders
// itself only sends a message when the current day/hour matches a configured
// reminder, and is idempotent per hour either way.
import { checkReminders } from "../src/bot.ts";

export default async function handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  // Vercel signs Cron requests with this header when CRON_SECRET is set.
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end("unauthorized");
    return;
  }
  try {
    await checkReminders();
    res.statusCode = 200;
    res.end("ok");
  } catch (err) {
    console.error("cron error", err);
    res.statusCode = 500;
    res.end("error");
  }
}
