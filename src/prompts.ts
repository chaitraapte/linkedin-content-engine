import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

// ---------- Style reference ----------

function readStyleFile(name: string): string {
  try {
    return fs.readFileSync(path.join(config.styleDir, name), "utf8").trim();
  } catch {
    return "";
  }
}

/** Strip the instructional HTML comments from the template files. */
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();

export function loadStyle() {
  return {
    aboutMe: stripComments(readStyleFile("about_me.md")),
    pastPosts: stripComments(readStyleFile("my_posts.md")),
    approvedPosts: stripComments(readStyleFile("approved_posts.md")),
  };
}

export function appendApprovedPost(text: string) {
  const file = path.join(config.styleDir, "approved_posts.md");
  const header = fs.existsSync(file) ? "" : "<!-- Posts you approved through the bot. Used as extra style reference. -->\n";
  fs.appendFileSync(file, `${header}\n---\n${text.trim()}\n`);
}

// ---------- Idea evaluation (Gemini) ----------

export interface IdeaEval {
  scores: {
    audience_relevance: number;
    originality: number;
    insight_strength: number;
    personal_angle: number;
    business_relevance: number;
    post_potential: number;
  };
  overall: number;
  verdict: "develop" | "save" | "reject";
  reasoning: string;
  make_it_stronger: string[];
  question_for_you: string;
  working_title: string;
  search_queries: string[];
}

const score = { type: "number", minimum: 0, maximum: 10 };

export const ideaEvalSchema = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: {
        audience_relevance: score,
        originality: score,
        insight_strength: score,
        personal_angle: score,
        business_relevance: score,
        post_potential: score,
      },
      required: ["audience_relevance", "originality", "insight_strength", "personal_angle", "business_relevance", "post_potential"],
    },
    overall: score,
    verdict: { type: "string", enum: ["develop", "save", "reject"] },
    reasoning: { type: "string" },
    make_it_stronger: { type: "array", items: { type: "string" } },
    question_for_you: { type: "string" },
    working_title: { type: "string" },
    search_queries: { type: "array", items: { type: "string" } },
  },
  required: ["scores", "overall", "verdict", "reasoning", "make_it_stronger", "question_for_you", "working_title", "search_queries"],
};

export function ideaEvalPrompt(idea: string, notes: string[], aboutMe: string) {
  return `You are a sharp, honest editor helping the author decide which raw ideas are worth turning into a LinkedIn post. They post a few times a week, so only ideas with real potential should go forward.

ABOUT THE AUTHOR
${aboutMe || "Fill in style/about_me.md to describe the author, their audience and what they write about."}

RAW IDEA (captured quickly, unpolished — judge the underlying thought, not the wording)
"""${idea}"""
${notes.length ? `\nEXTRA DETAIL THE AUTHOR ADDED\n${notes.map((n) => `- ${n}`).join("\n")}\n` : ""}
Score each criterion 0–10 (be calibrated: 5 = ordinary, 7 = good, 9+ = rare):
- audience_relevance: would their LinkedIn audience care?
- originality: is this a fresh take, or something everyone already says?
- insight_strength: is there a real, non-obvious point underneath?
- personal_angle: is it grounded in something the author actually saw, did or felt?
- business_relevance: does it connect to how business actually works?
- post_potential: could this become a meaningful, specific post?

overall: your holistic 0–10 score (one decimal allowed), not just an average.
verdict: "develop" if worth writing this week, "save" if promising but needs more experience/detail or timing, "reject" if generic or weak.
reasoning: 2–3 plain sentences explaining the score.
make_it_stronger: 2–4 specific, actionable suggestions (e.g. "Name the class and what the professor actually said").
question_for_you: ONE question to ask the author that would draw out the personal story or specific detail this idea is missing.
working_title: a short internal label (max 8 words).
search_queries: 2–3 Google News search queries to find current business context, data or examples relevant to this idea.`;
}

// ---------- Context research (Gemini + Google Search) ----------

export function contextPrompt(idea: string, notes: string[], headlines: string) {
  return `Research current context for a LinkedIn post the author is writing. The purpose is to make their personal observation better informed — NOT to replace it.

THEIR IDEA
"""${idea}"""
${notes.length ? `Extra detail: ${notes.join(" | ")}\n` : ""}
RECENT GOOGLE NEWS HEADLINES (may or may not be relevant)
${headlines || "(none found)"}

Search the web and return a concise research brief in plain text with these sections:
1. Recent developments (2–3 items, with dates) — only if genuinely relevant
2. Companies / real examples that illustrate the idea (2–3)
3. Data or statistics (1–3), each with its source name
4. A contrasting perspective — who would disagree, and why
5. The single most useful piece of context for this post, in one line

Be factual. If you can't verify a number, leave it out. Keep the whole brief under 350 words.`;
}

// ---------- Drafting (Claude) ----------

export function draftSystemPrompt() {
  const { aboutMe, pastPosts, approvedPosts } = loadStyle();
  return `You are ghost-editing LinkedIn posts for one specific person. Your job is to turn their raw idea into a post that sounds unmistakably like them — their vocabulary, rhythm, sentence length, formatting habits, level of formality, and the way they open and close posts. You are not writing "a good LinkedIn post"; you are writing THEIR post.

<about_the_author>
${aboutMe || "Fill in style/about_me.md to describe the author."}
</about_the_author>

<their_past_posts>
${pastPosts || "(No past posts provided yet. Write in a plain, direct, first-person voice of a thoughtful business student. Avoid LinkedIn clichés.)"}
</their_past_posts>
${approvedPosts ? `\n<posts_they_recently_approved>\n${approvedPosts}\n</posts_they_recently_approved>\n` : ""}
How to write:
- The author's own observation and experience is the spine of the post. External context supports it; it never takes over. Use at most one or two pieces of context, and only if they sharpen the point.
- Be specific: real moments, real names of classes/companies, concrete numbers. Never invent personal experiences, people, quotes or numbers the author didn't give you — if a specific detail would help but you don't have it, write around it rather than fabricating.
- Match the length and formatting of their past posts. If there are no past posts, aim for 120–220 words, short paragraphs.
- Avoid the tells of AI-written LinkedIn content: "Here's the thing", "Let that sink in", "In today's fast-paced world", "game-changer", "unlock", "delve", "It's not X, it's Y" constructions, rhetorical triplets, one-word dramatic lines, emoji bullet lists, a moral at the end that restates the post, and hashtag walls. Use hashtags only if their past posts do.
- The hook (first 1–2 lines) must be specific to this idea, not a generic attention-grabber.

Output only the post text, ready to paste into LinkedIn. No preamble, no title, no commentary.`;
}

export function draftUserPrompt(p: { idea: string; notes: string[]; context: string | null; ideaEval: IdeaEval | null }) {
  return `<raw_idea>
${p.idea}
</raw_idea>
${p.notes.length ? `\n<extra_detail_from_author>\n${p.notes.join("\n")}\n</extra_detail_from_author>\n` : ""}${
    p.context ? `\n<research_context>\n${p.context}\n</research_context>\n` : ""
  }${
    p.ideaEval ? `\n<editor_notes_on_the_idea>\n${p.ideaEval.reasoning}\nTo make it stronger: ${p.ideaEval.make_it_stronger.join("; ")}\n</editor_notes_on_the_idea>\n` : ""
  }
Write the post.`;
}

export function revisePrompt(previous: string, feedback: string) {
  return `Here is the current draft:

<draft>
${previous}
</draft>

Revise it based on this feedback:

<feedback>
${feedback}
</feedback>

Keep everything that already works. Keep the author's voice. Output only the revised post text.`;
}

// ---------- Post evaluation (Claude) ----------

export interface PostEval {
  scores: {
    hook: number;
    clarity: number;
    insight: number;
    personal_voice: number;
    specificity: number;
    readability: number;
    business_relevance: number;
    originality: number;
    human_not_generic: number;
  };
  overall: number;
  what_works: string[];
  needs_improvement: string[];
  weakest_part: string;
  recommendations: string[];
  ai_sounding_phrases: string[];
}

const pscore = { type: "number" };

export const postEvalSchema = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: {
        hook: pscore,
        clarity: pscore,
        insight: pscore,
        personal_voice: pscore,
        specificity: pscore,
        readability: pscore,
        business_relevance: pscore,
        originality: pscore,
        human_not_generic: pscore,
      },
      required: ["hook", "clarity", "insight", "personal_voice", "specificity", "readability", "business_relevance", "originality", "human_not_generic"],
      additionalProperties: false,
    },
    overall: pscore,
    what_works: { type: "array", items: { type: "string" } },
    needs_improvement: { type: "array", items: { type: "string" } },
    weakest_part: { type: "string" },
    recommendations: { type: "array", items: { type: "string" } },
    ai_sounding_phrases: { type: "array", items: { type: "string" } },
  },
  required: ["scores", "overall", "what_works", "needs_improvement", "weakest_part", "recommendations", "ai_sounding_phrases"],
  additionalProperties: false,
};

export function postEvalSystemPrompt() {
  const { pastPosts } = loadStyle();
  return `You are a demanding LinkedIn editor reviewing a draft before its author decides whether to publish. You did not write it; judge it honestly. Most drafts are 6–7.5; reserve 9+ for posts you'd genuinely stop scrolling for.

${pastPosts ? `The author's past posts, for judging whether the draft sounds like them:\n<their_past_posts>\n${pastPosts}\n</their_past_posts>\n` : ""}
Score each criterion 0–10:
- hook: do the first two lines earn the "see more" click, specifically?
- clarity: is the point easy to follow?
- insight: is there a real, non-obvious takeaway?
- personal_voice: does it sound like this specific person${pastPosts ? " (compare with past posts)" : ""}?
- specificity: concrete moments, names, numbers vs. vague generalities
- readability: rhythm, length, formatting for LinkedIn
- business_relevance
- originality
- human_not_generic: 10 = clearly human; 0 = reads like generic AI LinkedIn content

overall: holistic 0–10 score (one decimal allowed).
what_works: 2–3 short points.
needs_improvement: 2–3 short points.
weakest_part: quote the single weakest sentence or line verbatim, then say why in a few words.
recommendations: 2–4 concrete, actionable edits (e.g. "Open with the moment in the marketing class instead of the general claim").
ai_sounding_phrases: exact phrases that sound AI-generated or clichéd (empty list if none).`;
}
