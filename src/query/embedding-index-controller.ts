import type { EmbeddingIndexProgress } from "./embeddings.js";

export type EmbeddingIndexState =
  | { kind: "idle" }
  | { kind: "building"; progress: EmbeddingIndexProgress }
  | { kind: "ready"; index: ReadonlyMap<string, number[]> }
  | {
      kind: "error";
      message: string;
      fallbackIndex: ReadonlyMap<string, number[]>;
    };

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

  subscribe(cb: (state: EmbeddingIndexState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async ensureBuilt(): Promise<ReadonlyMap<string, number[]>> {
    if (this.state.kind === "ready") return this.state.index;
    if (this.state.kind === "error") return this.state.fallbackIndex;
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
        const fallbackIndex: ReadonlyMap<string, number[]> = new Map();
        this.transition({ kind: "error", message, fallbackIndex });
        return fallbackIndex;
      } finally {
        this.buildPromise = null;
      }
    })();
    return this.buildPromise;
  }

  private transition(state: EmbeddingIndexState): void {
    this.state = state;
    for (const cb of this.listeners) cb(state);
  }
}
