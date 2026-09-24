import { Bot, InlineKeyboard, type Context } from "grammy";
import { config } from "./config.ts";
import * as store from "./store.ts";
import type { Idea } from "./store.ts";
import { draftPost, evaluateIdea, evaluatePost, researchContext, revisePost, transcribe } from "./gemini.ts";
import { headlinesFor } from "./news.ts";
import { appendApprovedPost, type IdeaEval, type PostEval } from "./prompts.ts";

export const bot = new Bot(config.telegramToken);

// chatId -> ideaId waiting for the author's edit instructions / rewritten post
const pendingEdit = new Map<number, number>();

// ---------- formatting ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const bullets = (items: string[]) => items.map((i) => `• ${esc(i)}`).join("\n");
const label = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function ideaCard(idea: Idea) {
  const e = idea.eval!;
  const breakdown = Object.entries(e.scores)
    .map(([k, v]) => `${label(k)}: ${fmt(v)}`)
    .join(" · ");
  const rec =
    e.overall >= config.ideaThreshold ? "✅ Worth developing" : e.verdict === "reject" ? "🗑 Probably not worth it" : "💾 Promising, but save for later";
  return [
    `<b>Idea #${idea.id} — ${esc(e.working_title)}</b>`,
    `<b>Idea score: ${fmt(e.overall)}/10</b>  ${rec}`,
    `<i>${esc(breakdown)}</i>`,
    ``,
    esc(e.reasoning),
    ``,
    `<b>What would make it stronger</b>`,
    bullets(e.make_it_stronger),
    ``,
    `❓ <b>${esc(e.question_for_you)}</b>`,
    `<i>Reply to this message (text or voice) to add detail and re-score.</i>`,
  ].join("\n");
}

function reviewCard(idea: Idea) {
  const d = idea.drafts.at(-1)!;
  const e = d.eval!;
  const lines = [
    `<b>Review gate — Idea #${idea.id}${idea.drafts.length > 1 ? ` (version ${idea.drafts.length})` : ""}</b>`,
    ``,
    `<b>Idea score:</b> ${fmt(idea.eval!.overall)}/10`,
    `<b>Post score:</b> ${fmt(e.overall)}/10`,
    `<i>${esc(Object.entries(e.scores).map(([k, v]) => `${label(k)}: ${fmt(v)}`).join(" · "))}</i>`,
    ``,
    `<b>What works</b>`,
    bullets(e.what_works),
    ``,
    `<b>What needs improvement</b>`,
    bullets(e.needs_improvement),
    ``,
    `<b>Weakest part</b>`,
    esc(e.weakest_part),
  ];
  if (e.ai_sounding_phrases.length) lines.push(``, `<b>Sounds AI-ish</b>`, bullets(e.ai_sounding_phrases.map((p) => `"${p}"`)));
  lines.push(``, `<b>Recommendations</b>`, bullets(e.recommendations), ``, `⬇️ Draft below`);
  return lines.join("\n");
}

const ideaKeyboard = (id: number) =>
  new InlineKeyboard().text("🚀 Develop now", `dev:${id}`).row().text("💾 Save for later", `save:${id}`).text("🗑 Reject", `rej:${id}`);

const reviewKeyboard = (id: number) =>
  new InlineKeyboard()
    .text("🪄 Apply recommendations", `apply:${id}`)
    .row()
    .text("✏️ Edit", `edit:${id}`)
    .text("✅ Approve", `ok:${id}`)
    .row()
    .text("💾 Save for later", `save:${id}`)
    .text("🗑 Reject", `rej:${id}`);

// ---------- helpers ----------

async function remember(idea: Idea, messageId: number) {
  idea.messageIds.push(messageId);
  await store.save();
}

/** A status message that updates in place while long steps run. */
async function status(ctx: Context, text: string) {
  const m = await ctx.reply(text);
  return {
    update: (t: string) => ctx.api.editMessageText(m.chat.id, m.message_id, t).catch(() => {}),
    done: () => ctx.api.deleteMessage(m.chat.id, m.message_id).catch(() => {}),
  };
}

async function fail(ctx: Context, step: string, err: unknown) {
  console.error(step, err);
  await ctx.reply(`⚠️ Something went wrong while ${step}: ${err instanceof Error ? err.message : String(err)}\nYour idea is saved — try again with /develop or /idea.`);
}

// ---------- pipeline ----------

async function scoreIdea(ctx: Context, idea: Idea) {
  const s = await status(ctx, "🧠 Evaluating your idea…");
  try {
    idea.eval = await evaluateIdea(idea.raw, idea.notes);
    await store.save();
  } catch (err) {
    await s.done();
    return fail(ctx, "evaluating the idea", err);
  }
  await s.done();
  const m = await ctx.reply(ideaCard(idea), { parse_mode: "HTML", reply_markup: ideaKeyboard(idea.id) });
  await remember(idea, m.message_id);
}

async function develop(ctx: Context, idea: Idea) {
  const started = Date.now();
  const s = await status(ctx, "🔎 Step 1/3 — Finding relevant business context…");
  try {
    if (!idea.eval) idea.eval = await evaluateIdea(idea.raw, idea.notes);
    if (!idea.context) {
      const headlines = await headlinesFor(idea.eval.search_queries).catch(() => "");
      idea.context = await researchContext(idea.raw, idea.notes, headlines).catch((err) => {
        console.error("research", err);
        return headlines ? `Recent headlines:\n${headlines}` : null;
      });
      await store.save();
    }
    await s.update("✍️ Step 2/3 — Drafting in your voice…");
    const text = await draftPost({ idea: idea.raw, notes: idea.notes, context: idea.context, ideaEval: idea.eval });
    await s.update("📏 Step 3/3 — Scoring the draft…");
    const ev = await evaluatePost(text, idea.raw);
    idea.drafts.push({ text, eval: ev, feedback: null, createdAt: new Date().toISOString() });
    idea.status = "in_review";
    await store.save();
  } catch (err) {
    await s.done();
    return fail(ctx, "developing the post", err);
  }
  await s.done();
  await sendReview(ctx, idea, Date.now() - started);
}

async function revise(ctx: Context, idea: Idea, feedback: string, ownVersion = false) {
  const s = await status(ctx, ownVersion ? "📏 Scoring your version…" : "✍️ Revising…");
  try {
    const previous = idea.drafts.at(-1)!.text;
    const text = ownVersion
      ? feedback
      : await revisePost({ idea: idea.raw, notes: idea.notes, context: idea.context, ideaEval: idea.eval }, previous, feedback);
    if (!ownVersion) await s.update("📏 Scoring the new version…");
    const ev = await evaluatePost(text, idea.raw);
    idea.drafts.push({ text, eval: ev, feedback: ownVersion ? "(author's own edit)" : feedback, createdAt: new Date().toISOString() });
    idea.status = "in_review";
    await store.save();
  } catch (err) {
    await s.done();
    return fail(ctx, "revising the post", err);
  }
  await s.done();
  await sendReview(ctx, idea);
}

async function sendReview(ctx: Context, idea: Idea, elapsedMs?: number) {
  const prev = idea.drafts.at(-2)?.eval?.overall;
  const cur = idea.drafts.at(-1)!;
  const m1 = await ctx.reply(reviewCard(idea), { parse_mode: "HTML" });
  // Draft goes in its own plain message so it copies cleanly into LinkedIn.
  const m2 = await ctx.reply(cur.text, { reply_markup: reviewKeyboard(idea.id) });
  await remember(idea, m1.message_id);
  await remember(idea, m2.message_id);
  const notes: string[] = [];
  if (prev !== undefined) notes.push(`Score ${fmt(prev)} → ${fmt(cur.eval!.overall)}`);
  if (elapsedMs) notes.push(`Ready in ${Math.round(elapsedMs / 1000)}s`);
  if (notes.length) await ctx.reply(`<i>${notes.join(" · ")}</i>`, { parse_mode: "HTML" });
}

// ---------- load state ----------

// Runs before every update. On Vercel, each invocation is a fresh process, so
// this pulls the latest data from Redis; locally it's a cheap no-op after the
// first call (see store.ts).
bot.use(async (ctx, next) => {
  await store.ensureLoaded();
  await next();
});

// ---------- access control ----------

bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (config.allowedUserId === null) {
    await ctx.reply(
      `👋 Your Telegram user ID is ${uid}.\nAdd TELEGRAM_ALLOWED_USER_ID=${uid} to your .env file and restart the bot. Until then the bot won't process anything.`,
    );
    return;
  }
  if (uid !== config.allowedUserId) return; // silently ignore everyone else
  await next();
});

// ---------- commands ----------

const HELP = `<b>Your LinkedIn content engine</b>

Just send me a thought — text or a voice note — whenever it hits you. No need to polish it.

I'll score it out of 10, and if it's worth it I'll research context, draft it in your voice, score the draft, and hand it back for your decision. Nothing gets posted without you.

<b>Commands</b>
/backlog — saved &amp; unreviewed ideas, best first
/ready — approved posts waiting to be published
/develop &lt;id&gt; — develop an idea now
/idea &lt;id&gt; — show an idea and its latest draft
/cancel — cancel a pending edit

<b>Tips</b>
• Reply to any of my messages about an idea to add detail (e.g. answer my question) — it gets re-scored.
• Tap ✏️ Edit, then send instructions ("make the hook about the pricing case") or paste your own rewritten version.`;

bot.command(["start", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

bot.command("cancel", (ctx) => {
  pendingEdit.delete(ctx.chat.id);
  return ctx.reply("Cancelled.");
});

function backlogText() {
  const ideas = store
    .listIdeas("saved", "new", "in_review")
    .sort((a, b) => (b.eval?.overall ?? 0) - (a.eval?.overall ?? 0));
  if (!ideas.length) return null;
  return ideas
    .slice(0, 15)
    .map((i) => {
      const tag = i.status === "in_review" ? " 📝 draft ready" : i.status === "new" ? " 🆕" : "";
      const title = i.eval?.working_title ?? i.raw.slice(0, 60);
      return `#${i.id} · <b>${i.eval ? fmt(i.eval.overall) : "?"}</b>/10 · ${esc(title)}${tag}`;
    })
    .join("\n");
}

bot.command("backlog", async (ctx) => {
  const text = backlogText();
  await ctx.reply(text ? `<b>Idea backlog</b>\n\n${text}\n\nUse /develop &lt;id&gt; to turn one into a post.` : "Backlog is empty — send me a thought!", {
    parse_mode: "HTML",
  });
});

bot.command("ready", async (ctx) => {
  const ideas = store.listIdeas("approved");
  if (!ideas.length) return ctx.reply("No approved posts yet.");
  for (const i of ideas.slice(-3)) await ctx.reply(`✅ #${i.id}\n\n${i.final}`);
});

function ideaFromArg(ctx: Context) {
  const id = Number(String(ctx.match ?? "").replace("#", "").trim());
  const idea = store.getIdea(id);
  if (!idea) ctx.reply("Which idea? Use e.g. /develop 3 — see /backlog for IDs.");
  return idea;
}

bot.command("develop", async (ctx) => {
  const idea = ideaFromArg(ctx);
  if (idea) await develop(ctx, idea);
});

bot.command("idea", async (ctx) => {
  const idea = ideaFromArg(ctx);
  if (!idea) return;
  if (idea.drafts.length) return sendReview(ctx, idea);
  if (idea.eval) {
    const m = await ctx.reply(ideaCard(idea), { parse_mode: "HTML", reply_markup: ideaKeyboard(idea.id) });
    return remember(idea, m.message_id);
  }
  await scoreIdea(ctx, idea);
});

// ---------- buttons ----------

bot.callbackQuery(/^(dev|save|rej|apply|edit|ok):(\d+)$/, async (ctx) => {
  const [, action, idStr] = ctx.match as RegExpMatchArray;
  const idea = store.getIdea(Number(idStr));
  await ctx.answerCallbackQuery();
  if (!idea) return ctx.reply("I can't find that idea any more.");
  // Remove buttons from the tapped message so decisions aren't made twice.
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  switch (action) {
    case "dev":
      return develop(ctx, idea);
    case "save":
      idea.status = "saved";
      await store.save();
      return ctx.reply(`💾 Saved idea #${idea.id} for later. It'll show up in /backlog and your Friday reminder.`);
    case "rej":
      idea.status = "rejected";
      await store.save();
      return ctx.reply(`🗑 Rejected idea #${idea.id}.`);
    case "apply": {
      const e = idea.drafts.at(-1)?.eval;
      return revise(ctx, idea, [...(e?.recommendations ?? []), ...(e?.ai_sounding_phrases.length ? [`Rewrite these phrases: ${e.ai_sounding_phrases.join("; ")}`] : [])].join("\n"));
    }
    case "edit":
      pendingEdit.set(ctx.chat!.id, idea.id);
      return ctx.reply(
        "✏️ Send me either:\n• instructions (\"make the opening about the Tuesday sales role-play\", or a voice note), or\n• your own edited version of the full post — I'll just re-score it.\n\n/cancel to stop.",
      );
    case "ok": {
      const text = idea.drafts.at(-1)!.text;
      idea.final = text;
      idea.status = "approved";
      await store.save();
      appendApprovedPost(text);
      await ctx.reply(`✅ Approved idea #${idea.id}. Here's the final text to paste into LinkedIn:`);
      return ctx.reply(text);
    }
  }
});

// ---------- incoming thoughts ----------

async function handleText(ctx: Context, text: string, source: "text" | "voice") {
  const chatId = ctx.chat!.id;

  // 1) Pending edit on a draft
  const editId = pendingEdit.get(chatId);
  if (editId !== undefined) {
    pendingEdit.delete(chatId);
    const idea = store.getIdea(editId)!;
    const current = idea.drafts.at(-1)!.text;
    // A message roughly as long as the draft is treated as the author's own rewrite.
    const ownVersion = source === "text" && text.length > current.length * 0.6;
    return revise(ctx, idea, text, ownVersion);
  }

  // 2) Reply to a message about an existing idea -> add detail and re-score
  const replyTo = ctx.message?.reply_to_message?.message_id;
  const target = replyTo ? store.findByMessage(replyTo) : undefined;
  if (target) {
    target.notes.push(text);
    target.context = null; // research again with the new detail
    await store.save();
    if (target.status === "in_review" || target.status === "approved") {
      return revise(ctx, target, `The author added this detail — work it in naturally:\n${text}`);
    }
    await ctx.reply(`📎 Added to idea #${target.id}. Re-scoring…`);
    return scoreIdea(ctx, target);
  }

  // 3) New idea
  const idea = await store.createIdea(text, source);
  await scoreIdea(ctx, idea);
}

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return ctx.reply("Unknown command. /help");
  await handleText(ctx, ctx.message.text, "text");
});

bot.on(["message:voice", "message:audio"], async (ctx) => {
  const media = ctx.message.voice ?? ctx.message.audio!;
  try {
    const file = await ctx.getFile();
    const res = await fetch(`https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`);
    const audio = Buffer.from(await res.arrayBuffer());
    const text = await transcribe(audio, media.mime_type ?? "audio/ogg");
    if (!text) return ctx.reply("I couldn't make out that voice note — try again?");
    await ctx.reply(`🎙 <i>${esc(text)}</i>`, { parse_mode: "HTML" });
    await handleText(ctx, text, "voice");
  } catch (err) {
    await fail(ctx, "transcribing your voice note", err);
  }
});

// ---------- weekly rhythm ----------

/**
 * Checks whether any configured reminder is due *right now* and sends it.
 * Called every minute by the long-polling entrypoint (local.ts), or once an
 * hour by the Vercel Cron job (api/cron.ts) — either way it's idempotent
 * per hour thanks to the reminderSent/markReminder guard.
 */
export async function checkReminders() {
  if (config.allowedUserId === null) return;
  await store.ensureLoaded();
  const now = new Date();
  for (const r of config.reminders) {
    if (now.getDay() !== r.day || now.getHours() !== r.hour) continue;
    const key = `${now.toISOString().slice(0, 10)}:${r.hour}`;
    if (store.reminderSent(key)) continue;
    await store.markReminder(key);

    const approved = store.listIdeas("approved").filter((i) => Date.now() - new Date(i.createdAt).getTime() < 14 * 864e5);
    const backlog = backlogText();
    const isFriday = r.day === 5;
    let msg = isFriday ? "📅 <b>It's Friday — posting day.</b>\n\n" : "📅 <b>Friday's coming.</b> Pick an idea to develop so you're not starting from scratch.\n\n";
    if (isFriday && approved.length) msg += `You have ${approved.length} approved post(s) ready — /ready to see them.\n\n`;
    msg += backlog ? `<b>Your best ideas</b>\n${backlog}\n\n/develop &lt;id&gt; to start (≈20 min to a finished post).` : "Your backlog is empty — send me any thought from this week, even a rough one.";
    await bot.api.sendMessage(config.allowedUserId, msg, { parse_mode: "HTML" }).catch((e) => console.error("reminder", e));
  }
}

bot.catch((err) => console.error("Bot error:", err.error));
