import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

export const config = {
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  // Only this Telegram user can use the bot. Leave empty on first run: the bot will tell you your ID.
  allowedUserId: process.env.TELEGRAM_ALLOWED_USER_ID ? Number(process.env.TELEGRAM_ALLOWED_USER_ID) : null,

  geminiApiKey: required("GEMINI_API_KEY"),
  // Used for triage (idea scoring), transcription and news/context research.
  geminiModel: process.env.GEMINI_MODEL || "gemini-flash-latest",
  // Used for drafting and post evaluation. A stronger model tends to write better long-form posts.
  geminiDraftModel: process.env.GEMINI_DRAFT_MODEL || process.env.GEMINI_MODEL || "gemini-pro-latest",

  // Ideas scoring at or above this are recommended for development.
  ideaThreshold: Number(process.env.IDEA_THRESHOLD || 6),

  // Google News region, e.g. hl=en-IN&gl=IN&ceid=IN:en for India.
  newsLocale: process.env.NEWS_LOCALE || "hl=en-IN&gl=IN&ceid=IN:en",

  // Reminders, local machine time. Format: "day:hour" where day 0=Sun ... 5=Fri.
  reminders: (process.env.REMINDERS || "3:18,5:9").split(",").map((s) => {
    const [d, h] = s.trim().split(":").map(Number);
    return { day: d, hour: h };
  }),

  dataFile: path.join(ROOT, "data", "db.json"),
  styleDir: path.join(ROOT, "style"),
};
