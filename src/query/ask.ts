import type { KnowledgeBase } from "../core/kb.js";
import type { LLMProvider } from "../llm/provider.js";
import { formatContextMarkdown } from "./format-context.js";
import { buildAskPrompt } from "./prompts.js";
import { retrieve, type RetrieveArgs } from "./retrieve.js";
import type { AnswerEvent } from "./types.js";

export interface AskArgs {
  question: string;
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folder?: string;
  embeddingIndex?: ReadonlyMap<string, number[]>;
  queryEmbedding?: number[] | null;
  signal?: AbortSignal;
}

export async function* ask(args: AskArgs): AsyncIterable<AnswerEvent> {
  try {
    const retrieveArgs: RetrieveArgs = {
      question: args.question,
      kb: args.kb,
      folder: args.folder,
      embeddingIndex: args.embeddingIndex,
      queryEmbedding: args.queryEmbedding,
    };
    const bundle = retrieve(retrieveArgs);
    yield { kind: "context", bundle };

    const context = formatContextMarkdown(bundle);
    const prompt = buildAskPrompt({ question: args.question, context });

    for await (const chunk of args.provider.complete({
      prompt,
      model: args.model,
      signal: args.signal,
    })) {
      yield { kind: "chunk", text: chunk };
    }
    yield { kind: "done" };
  } catch (err) {
    yield {
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
