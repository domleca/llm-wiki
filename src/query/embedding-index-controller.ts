import { LLMConnectError } from "../llm/provider.js";
import type { EmbeddingIndexProgress } from "./embeddings.js";

/**
 * Reason classifies error states so the UI can show appropriate copy.
 * `connect` = the LLM server is unreachable (typically Ollama not running);
 * `other`   = any other failure (HTTP 5xx, malformed response, etc.).
 */
export type EmbeddingIndexErrorReason = "connect" | "other";

export type EmbeddingIndexState =
  | { kind: "idle" }
  | { kind: "building"; progress: EmbeddingIndexProgress }
  | { kind: "ready"; index: ReadonlyMap<string, number[]> }
  | { kind: "error"; message: string; reason: EmbeddingIndexErrorReason };

export interface EmbeddingIndexControllerOptions {
  buildIndex: (
    onProgress: (progress: EmbeddingIndexProgress) => void,
  ) => Promise<ReadonlyMap<string, number[]>>;
}

export class EmbeddingIndexController {
  private state: EmbeddingIndexState = { kind: "idle" };
  private buildPromise: Promise<ReadonlyMap<string, number[]>> | null = null;
  private readonly listeners = new Set<(state: EmbeddingIndexState) => void>();

  constructor(private readonly opts: EmbeddingIndexControllerOptions) {}

  getState(): EmbeddingIndexState {
    return this.state;
  }

  /**
   * Registers a listener for every future state transition. Does NOT fire
   * immediately with the current state — callers should call getState()
   * first if they need the initial value. Returns an unsubscribe function.
   */
  subscribe(cb: (state: EmbeddingIndexState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  ensureBuilt(): Promise<ReadonlyMap<string, number[]>> {
    if (this.state.kind === "ready") return Promise.resolve(this.state.index);
    if (this.state.kind === "error") return Promise.resolve(new Map());
    if (this.buildPromise) return this.buildPromise;

    this.transition({
      kind: "building",
      progress: { current: 0, total: 0 },
    });
    this.buildPromise = (async () => {
      try {
        const index = await this.opts.buildIndex((progress) => {
          this.transition({ kind: "building", progress });
        });
        this.transition({ kind: "ready", index });
        return index;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reason: EmbeddingIndexErrorReason =
          err instanceof LLMConnectError ? "connect" : "other";
        this.transition({ kind: "error", message, reason });
        return new Map<string, number[]>();
      } finally {
        this.buildPromise = null;
      }
    })();
    return this.buildPromise;
  }

  /**
   * Resets an error state back to idle and re-runs the build. No-op if the
   * controller is not in error. Returns the new build promise (or the
   * existing index if already ready).
   */
  retry(): Promise<ReadonlyMap<string, number[]>> {
    if (this.state.kind === "error") {
      this.transition({ kind: "idle" });
    }
    return this.ensureBuilt();
  }

  private transition(state: EmbeddingIndexState): void {
    this.state = state;
    // Snapshot listeners so a callback that unsubscribes itself (or a sibling)
    // mid-fan-out doesn't skip later listeners.
    for (const cb of [...this.listeners]) cb(state);
  }
}
