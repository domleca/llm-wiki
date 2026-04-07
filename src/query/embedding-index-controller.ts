import type { EmbeddingIndexProgress } from "./embeddings.js";

export type EmbeddingIndexState =
  | { kind: "idle" }
  | { kind: "building"; progress: EmbeddingIndexProgress }
  | { kind: "ready"; index: ReadonlyMap<string, number[]> }
  | { kind: "error"; message: string };

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

  async ensureBuilt(): Promise<ReadonlyMap<string, number[]>> {
    if (this.state.kind === "ready") return this.state.index;
    if (this.state.kind === "error") return new Map();
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
        this.transition({ kind: "error", message });
        return new Map<string, number[]>();
      } finally {
        this.buildPromise = null;
      }
    })();
    return this.buildPromise;
  }

  private transition(state: EmbeddingIndexState): void {
    this.state = state;
    // Snapshot listeners so a callback that unsubscribes itself (or a sibling)
    // mid-fan-out doesn't skip later listeners.
    for (const cb of [...this.listeners]) cb(state);
  }
}
