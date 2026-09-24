// Runs one idea through the whole pipeline in the terminal (no Telegram needed).
// Usage: npm run check -- "your idea here"
import { draftPost, evaluateIdea, evaluatePost, researchContext } from "./gemini.ts";
import { headlinesFor } from "./news.ts";

const idea =
  process.argv.slice(2).join(" ") ||
  "Today's class made me realise that business students spend a lot of time learning frameworks but very little time learning how to actually sell.";

const t0 = Date.now();
const step = (s: string) => console.log(`\n=== ${s} (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);

step("Idea evaluation (Gemini)");
const ideaEval = await evaluateIdea(idea, []);
console.log(JSON.stringify(ideaEval, null, 2));

step("Google News headlines");
const headlines = await headlinesFor(ideaEval.search_queries);
console.log(headlines || "(none)");

step("Context brief (Gemini + Google Search)");
const context = await researchContext(idea, [], headlines);
console.log(context);

step("Draft (Gemini)");
const post = await draftPost({ idea, notes: [], context, ideaEval });
console.log(post);

step("Post evaluation (Gemini)");
console.log(JSON.stringify(await evaluatePost(post, idea), null, 2));
step("Done");
