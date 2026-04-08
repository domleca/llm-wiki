/**
 * LLM call that rewrites a follow-up question into a standalone form, using
 * conversation history to resolve pronouns and implied subjects. Used by the
 * chat-turn flow before retrieval so hybrid search sees a self-contained query.
 */

import type { LLMProvider } from "../llm/provider.js";
import type { ChatTurn } from "./types.js";

export interface RewriteArgs {
  provider: LLMProvider;
  model: string;
  history: readonly ChatTurn[];
  question: string;
  signal?: AbortSignal;
}

function buildRewritePrompt(
  history: readonly ChatTurn[],
  question: string,
): string {
  const lines: string[] = [
    "Rewrite the user's latest question into a single standalone sentence that can be understood without the prior conversation.",
    "Resolve pronouns and implied subjects using the conversation below.",
    "Output ONLY the rewritten question, no preamble, no quotes, no explanation.",
    "",
    "Conversation:",
  ];
  for (const t of history) {
    lines.push(`[user] ${t.question}`);
    lines.push(`[assistant] ${t.answer}`);
  }
  lines.push("", `Latest question: ${question}`, "", "Standalone question:");
  return lines.join("\n");
}

export async function rewriteFollowUp(args: RewriteArgs): Promise<string> {
  const prompt = buildRewritePrompt(args.history, args.question);
  let out = "";
  for await (const chunk of args.provider.complete({
    prompt,
    model: args.model,
    temperature: 0.1,
    signal: args.signal,
  })) {
    out += chunk;
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : args.question;
}
