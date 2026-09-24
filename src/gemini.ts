import { GoogleGenAI } from "@google/genai";
import { config } from "./config.ts";
import {
  contextPrompt,
  draftSystemPrompt,
  draftUserPrompt,
  ideaEvalPrompt,
  ideaEvalSchema,
  loadStyle,
  postEvalSchema,
  postEvalSystemPrompt,
  revisePrompt,
  type IdeaEval,
  type PostEval,
} from "./prompts.ts";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

/** Transcribe a Telegram voice note (OGG/Opus). */
export async function transcribe(audio: Buffer, mimeType = "audio/ogg"): Promise<string> {
  const res = await ai.models.generateContent({
    model: config.geminiModel,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: audio.toString("base64") } },
          {
            text: "Transcribe this voice note exactly as spoken. Remove filler words (um, uh, like) but keep the speaker's own wording. Output only the transcript.",
          },
        ],
      },
    ],
  });
  return (res.text ?? "").trim();
}

export async function evaluateIdea(idea: string, notes: string[]): Promise<IdeaEval> {
  const res = await ai.models.generateContent({
    model: config.geminiModel,
    contents: ideaEvalPrompt(idea, notes, loadStyle().aboutMe),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: ideaEvalSchema,
      temperature: 0.3,
    },
  });
  return JSON.parse(res.text ?? "{}") as IdeaEval;
}

/** Research brief grounded in Google Search, plus the source links it used. */
export async function researchContext(idea: string, notes: string[], headlines: string): Promise<string> {
  const res = await ai.models.generateContent({
    model: config.geminiModel,
    contents: contextPrompt(idea, notes, headlines),
    config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
  });
  const brief = (res.text ?? "").trim();
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = [...new Set(chunks.map((c) => c.web?.title).filter(Boolean))].slice(0, 6);
  return sources.length ? `${brief}\n\nSources consulted: ${sources.join(", ")}` : brief;
}

// ---------- Drafting, revising, evaluating (Gemini) ----------

type DraftInput = { idea: string; notes: string[]; context: string | null; ideaEval: IdeaEval | null };

async function generate(systemInstruction: string, contents: { role: "user" | "model"; parts: { text: string }[] }[]) {
  const res = await ai.models.generateContent({
    model: config.geminiDraftModel,
    contents,
    config: { systemInstruction, temperature: 0.7 },
  });
  const text = (res.text ?? "").trim();
  if (!text) throw new Error(`Gemini returned no text (finishReason: ${res.candidates?.[0]?.finishReason ?? "unknown"}).`);
  return text;
}

export async function draftPost(p: DraftInput) {
  return generate(draftSystemPrompt(), [{ role: "user", parts: [{ text: draftUserPrompt(p) }] }]);
}

/** Revise within the same conversation so the model keeps the full brief in view. */
export async function revisePost(p: DraftInput, previous: string, feedback: string) {
  return generate(draftSystemPrompt(), [
    { role: "user", parts: [{ text: draftUserPrompt(p) }] },
    { role: "model", parts: [{ text: previous }] },
    { role: "user", parts: [{ text: revisePrompt(previous, feedback) }] },
  ]);
}

export async function evaluatePost(post: string, idea: string): Promise<PostEval> {
  const res = await ai.models.generateContent({
    model: config.geminiDraftModel,
    contents: `The author's original raw idea:\n"""${idea}"""\n\nThe draft to review:\n"""${post}"""`,
    config: {
      systemInstruction: postEvalSystemPrompt(),
      responseMimeType: "application/json",
      responseJsonSchema: postEvalSchema,
      temperature: 0.3,
    },
  });
  return JSON.parse(res.text ?? "{}") as PostEval;
}
