import type { KnowledgeBase } from "../../core/kb.js";
import { ask } from "../../query/ask.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { RetrievedBundle } from "../../query/types.js";
import { assessConfidence, type ConfidenceLevel } from "../../query/confidence.js";
import type { Chat } from "../../chat/types.js";
import { rewriteFollowUp } from "../../chat/rewrite.js";
import { getModelContextWindow } from "../../chat/model-context.js";
import { budgetHistory } from "../../chat/history-budget.js";

const RESERVE_TOKENS = 2048;

export type QueryControllerState =
  | "idle"
  | "loading"
  | "streaming"
  | "done"
  | "error"
  | "cancelled";

export interface QueryControllerOptions {
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folders?: string[];
  embeddingIndex?: ReadonlyMap<string, number[]>;
  queryEmbedding?: number[] | null;
  onState: (s: QueryControllerState) => void;
  onContext: (bundle: RetrievedBundle, confidence: ConfidenceLevel) => void;
  onChunk: (text: string) => void;
  onError?: (msg: string) => void;
  onRetrievalQuery?: (q: string) => void;
}

export class QueryController {
  private state: QueryControllerState = "idle";
  private abortCtrl: AbortController | null = null;
  private currentModel: string;
  private currentFolders: string[] | undefined;

  constructor(private readonly opts: QueryControllerOptions) {
    this.currentModel = opts.model;
    this.currentFolders = opts.folders;
  }

  getState(): QueryControllerState {
    return this.state;
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  setFolders(folders: string[]): void {
    this.currentFolders = folders.length > 0 ? folders : undefined;
  }

  async runChatTurn(args: { chat: Chat; question: string }): Promise<void> {
    this.abortCtrl = new AbortController();
    this.transition("loading");

    try {
      const isFollowUp = args.chat.turns.length > 0;
      const retrievalQuery = isFollowUp
        ? await rewriteFollowUp({
            provider: this.opts.provider,
            model: this.currentModel,
            history: args.chat.turns,
            question: args.question,
            signal: this.abortCtrl.signal,
          })
        : args.question;

      this.opts.onRetrievalQuery?.(retrievalQuery);

      const ctx = await getModelContextWindow(this.opts.provider, this.currentModel);
      const history = budgetHistory(args.chat.turns, {
        availableTokens: Math.max(0, ctx - RESERVE_TOKENS),
      });

      for await (const ev of ask({
        question: args.question,
        retrievalQuery,
        history,
        kb: this.opts.kb,
        provider: this.opts.provider,
        model: this.currentModel,
        folders: this.currentFolders,
        embeddingIndex: this.opts.embeddingIndex,
        queryEmbedding: this.opts.queryEmbedding,
        signal: this.abortCtrl.signal,
      })) {
        if (this.state === "cancelled") return;
        if (ev.kind === "context" && ev.bundle) {
          this.opts.onContext(ev.bundle, assessConfidence(ev.bundle));
          this.transition("streaming");
        } else if (ev.kind === "chunk" && ev.text) {
          this.opts.onChunk(ev.text);
        } else if (ev.kind === "done") {
          this.transition("done");
        } else if (ev.kind === "error") {
          this.opts.onError?.(ev.error ?? "unknown error");
          this.transition("error");
        }
      }
    } catch (err) {
      if (this.state !== "cancelled") {
        this.opts.onError?.(err instanceof Error ? err.message : String(err));
        this.transition("error");
      }
    }
  }

  async run(question: string): Promise<void> {
    const chatFolder =
      this.currentFolders && this.currentFolders.length === 1
        ? this.currentFolders[0]
        : "";

    const emptyChat: Chat = {
      id: "transient",
      title: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      folder: chatFolder,
      model: this.currentModel,
      turns: [],
    };
    await this.runChatTurn({ chat: emptyChat, question });
  }

  cancel(): void {
    if (this.abortCtrl) this.abortCtrl.abort();
    this.transition("cancelled");
  }

  private transition(next: QueryControllerState): void {
    this.state = next;
    this.opts.onState(next);
  }
}
