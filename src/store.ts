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

let db: DB = load();

function load(): DB {
  try {
    return JSON.parse(fs.readFileSync(config.dataFile, "utf8"));
  } catch {
    return { nextId: 1, ideas: [], reminders: {} };
  }
}

export function save() {
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  const tmp = config.dataFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, config.dataFile);
}

export function createIdea(raw: string, source: "text" | "voice"): Idea {
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
  save();
  return idea;
}

export const getIdea = (id: number) => db.ideas.find((i) => i.id === id);
export const findByMessage = (messageId: number) => db.ideas.find((i) => i.messageIds.includes(messageId));
export const listIdeas = (...statuses: IdeaStatus[]) => db.ideas.filter((i) => statuses.includes(i.status));

export function reminderSent(key: string) {
  return !!db.reminders[key];
}
export function markReminder(key: string) {
  db.reminders[key] = true;
  save();
}
