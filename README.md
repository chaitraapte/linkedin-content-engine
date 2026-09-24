# LinkedIn Content Engine (Telegram)

A personal Telegram bot that turns raw thoughts into LinkedIn posts that sound like you, and leaves the final decision to you.

**Capture → Evaluate → Contextualise → Draft → Evaluate → Review → (you) Publish**

| Step | What happens | Powered by |
|---|---|---|
| Capture | Send a text or voice note to your bot, any time | Telegram |
| Transcribe | Voice notes → text | Gemini Flash |
| Evaluate idea | 6-criterion score /10, reasoning, how to make it stronger, one question to draw out your story | Gemini Flash |
| Contextualise | Google News headlines + a Google-Search-grounded research brief (news, companies, data, a contrasting view) | Google News RSS + Gemini |
| Draft | Your idea + your detail + context, written in the style of your past posts | Gemini |
| Evaluate post | 9-criterion score /10, what works, what doesn't, weakest line, AI-sounding phrases, recommendations | Gemini (separate call, as a critic) |
| Review gate | 🪄 Apply recommendations · ✏️ Edit · ✅ Approve · 💾 Save for later · 🗑 Reject | You |

Nothing is ever posted automatically. **Approve** gives you clean text to paste into LinkedIn.

## Setup (≈10 minutes, once)

You need Node.js 23.6 or newer (`node --version`).

1. **Create your bot.** In Telegram, message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. **Get an API key:** Gemini — https://aistudio.google.com/apikey
3. **Configure:**
   ```bash
   cp .env.example .env
   ```
   Paste the bot token and Gemini key into `.env`.
4. **Install and start:**
   ```bash
   npm install
   npm start
   ```
5. **Lock it to you.** Message your bot anything. It replies with your Telegram user ID. Put that in `.env` as `TELEGRAM_ALLOWED_USER_ID=...` and restart (`Ctrl+C`, then `npm start`). After that the bot ignores everyone else.
6. **Teach it your voice (important).** Paste 3–10 of your real LinkedIn posts into [style/my_posts.md](style/my_posts.md), separated by `---`, and edit [style/about_me.md](style/about_me.md). These files are re-read on every draft, so you don't need to restart after editing them. Every post you approve is also added to `style/approved_posts.md`, so the style reference keeps improving.

To test the whole pipeline in your terminal without Telegram:
```bash
npm run check -- "your idea here"
```

## Using it

- **Have a thought? Send it.** Rough is fine: "prof said pricing is the most under-taught skill, agree??"
- You'll get an **idea score** and a question. **Reply to that message** (text or voice) with the story behind it. The detail gets added and the idea is re-scored. This is what makes the post sound like you.
- Tap **🚀 Develop now**, or **💾 Save for later** to build a backlog.
- About a minute later you get the **review gate**: idea score, post score, what works, what needs improvement, the weakest line, recommendations, and the draft as its own message so it copies cleanly.
- **🪄 Apply recommendations** revises the draft for you. **✏️ Edit** lets you send instructions ("open with the role-play, drop the stat") or paste your own rewritten version, which just gets re-scored. You can also reply to the draft with a new detail.
- **✅ Approve** gives you the final text.

Commands: `/backlog` · `/ready` · `/develop <id>` · `/idea <id>` · `/cancel` · `/help`

**Weekly rhythm:** by default you get a nudge on **Wednesday at 6pm** with your best saved ideas and a **Friday 9am** posting-day reminder. Change these with `REMINDERS` in `.env`.

## Good to know

- **The bot only works while `npm start` is running.** On a laptop, ideas sent while it's asleep are processed when you start it again, because Telegram keeps them for 24 hours. To have it always on, run it on a small always-on machine or a cheap cloud VM (e.g. Railway, Fly.io, a Raspberry Pi).
- **Cost:** a full idea → draft → review cycle is a few cents, or free on Gemini's free tier for personal use.
- **Your data** lives in `data/db.json` (every idea, score, context brief and draft version) on your machine.
- **Models** are set in `.env`: `GEMINI_MODEL` (triage, transcription, research) and `GEMINI_DRAFT_MODEL` (drafting + post scoring — a stronger model writes better long-form posts).
- Research can fail (rate limits, no results). If it does, the bot falls back to headlines only, or no context. The draft still happens.

## Files

```
src/bot.ts       Telegram flows, buttons, reminders
src/gemini.ts    transcription, idea scoring, grounded research, drafting, revising, post scoring
src/news.ts      Google News RSS search
src/prompts.ts   all rubrics and prompts (tune the scoring here)
src/check.ts     terminal test of the full pipeline
style/           your voice: about_me.md, my_posts.md, approved_posts.md
data/db.json     your ideas and drafts (created automatically)
```
