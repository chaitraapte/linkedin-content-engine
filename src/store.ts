import { Redis } from "@upstash/redis";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import type { IdeaEval, PostEval } from "./prompts.ts";

export type IdeaStatus = "new" | "saved" | "rejected" | "in_review" | "approved";

export interface Draft {
  text: string;
  eval: PostEval | null;
  feedback: string | null; // what prompted this version (null for the first draft)
  createdAt: string;
}

export interface Idea {
  id: number;
  createdAt: string;
  source: "text" | "voice";
  raw: string;
  notes: string[]; // extra personal detail added later by replying
  eval: IdeaEval | null;
  status: IdeaStatus;
  context: string | null;
  drafts: Draft[];
  final: string | null;
  messageIds: number[]; // bot messages about this idea, so replies can be routed to it
}

interface DB {
  nextId: number;
  ideas: Idea[];
  reminders: Record<string, boolean>; // "YYYY-MM-DD:hour" -> sent
}

const empty = (): DB => ({ nextId: 1, ideas: [], reminders: {} });
const KV_KEY = "linkedin-content-engine:db";

// Serverless (Vercel): no local disk between invocations -> Redis (Upstash,
// connected via a Vercel Marketplace storage integration). Env var names
// depend on which integration you connect, so check the common aliases.
// Local/always-on host: none of these set -> falls back to a local JSON
// file, same as before, so `npm start` still works with no cloud storage.
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = kvUrl && kvToken ? new Redis({ url: kvUrl, token: kvToken }) : null;

let db: DB = empty();
let loaded = false;

async function readFromDisk(): Promise<DB> {
  try {
    return JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
  } catch {
    return empty();
  }
}

function writeToDisk() {
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  const tmp = config.dataFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, config.dataFile);
}

/** Load the latest state. Call this once at the start of every request/invocation. */
export async function ensureLoaded() {
  if (redis) {
    db = (await redis.get<DB>(KV_KEY)) ?? empty();
  } else if (!loaded) {
    db = await readFromDisk();
  }
  loaded = true;
}

export async function save() {
  if (redis) {
    await redis.set(KV_KEY, db);
  } else {
    writeToDisk();
  }
}

export async function createIdea(raw: string, source: "text" | "voice"): Promise<Idea> {
  const idea: Idea = {
    id: db.nextId++,
    createdAt: new Date().toISOString(),
    source,
    raw,
    notes: [],
    eval: null,
    status: "new",
    context: null,
    drafts: [],
    final: null,
    messageIds: [],
  };
  db.ideas.push(idea);
  await save();
  return idea;
}

export const getIdea = (id: number) => db.ideas.find((i) => i.id === id);
export const findByMessage = (messageId: number) => db.ideas.find((i) => i.messageIds.includes(messageId));
export const listIdeas = (...statuses: IdeaStatus[]) => db.ideas.filter((i) => statuses.includes(i.status));

export function reminderSent(key: string) {
  return !!db.reminders[key];
}
export async function markReminder(key: string) {
  db.reminders[key] = true;
  await save();
}
