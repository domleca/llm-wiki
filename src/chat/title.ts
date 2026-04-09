/**
 * Generates a short (≤6 word) chat title from the first turn via a small LLM call.
 * Used by the chat-turn flow as a background task after the first answer completes.
 */

import type { LLMProvider } from "../llm/provider.js";

export interface TitleArgs {
  provider: LLMProvider;
  model: string;
  question: string;
  signal?: AbortSignal;
}

export async function generateChatTitle(args: TitleArgs): Promise<string> {
  const prompt = [
    "Summarize this question as a short chat title of at most 6 words.",
    "Output only the title. No quotes, no trailing punctuation, no preamble.",
    "",
    `Q: ${args.question}`,
    "",
    "Title:",
  ].join("\n");

  let out = "";
  try {
    for await (const chunk of args.provider.complete({
      prompt,
      model: args.model,
      temperature: 0.2,
      signal: args.signal,
    })) {
      out += chunk;
    }
  } catch {
    return "Untitled";
  }

  let t = out
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (t.length === 0) return "Untitled";
  const words = t.split(/\s+/);
  if (words.length > 6) t = words.slice(0, 6).join(" ");
  return t;
}
