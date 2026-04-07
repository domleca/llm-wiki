import type { EmbeddingIndexState } from "../../query/embedding-index-controller.js";

export function formatIndexingStatus(state: EmbeddingIndexState): string {
  switch (state.kind) {
    case "idle":
      return "Preparing…";
    case "building": {
      const { current, total } = state.progress;
      if (total === 0) return "Building index…";
      return `Building index… ${current} / ${total}`;
    }
    case "ready":
      return "Ready";
    case "error":
      return `Embedding index unavailable (${state.message}) — keyword-only fallback`;
  }
}
