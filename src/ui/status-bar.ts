import type { ProgressEmitter } from "../runtime/progress.js";
import {
  formatIndexingLabel,
  type StatusBarState,
} from "./status-bar-format.js";

/**
 * Subscribes to a ProgressEmitter and updates a single HTMLElement
 * (Obsidian's status-bar item) with the formatted label.
 */
export class StatusBarWidget {
  private batchStart = 0;
  private processed = 0;
  private total = 0;

  constructor(
    private readonly el: Pick<HTMLElement, "setText">,
    emitter: ProgressEmitter,
  ) {
    this.render({ state: "idle" });

    emitter.on("batch-started", (d) => {
      this.batchStart = Date.now();
      this.processed = 0;
      this.total = d.total;
      this.render({
        state: "indexing",
        processed: 0,
        total: this.total,
        elapsedMs: 0,
      });
    });

    emitter.on("file-completed", (d) => {
      this.processed = d.index;
      this.render({
        state: "indexing",
        processed: this.processed,
        total: this.total,
        elapsedMs: Date.now() - this.batchStart,
      });
    });

    emitter.on("file-failed", (d) => {
      this.processed = d.index;
      this.render({
        state: "indexing",
        processed: this.processed,
        total: this.total,
        elapsedMs: Date.now() - this.batchStart,
      });
    });

    emitter.on("file-skipped", (d) => {
      this.processed = d.index;
      this.render({
        state: "indexing",
        processed: this.processed,
        total: this.total,
        elapsedMs: Date.now() - this.batchStart,
      });
    });

    emitter.on("batch-completed", () => {
      this.render({ state: "idle" });
    });

    emitter.on("batch-cancelled", () => {
      this.render({ state: "idle" });
    });

    emitter.on("batch-errored", (d) => {
      this.render({ state: "error", message: d.message });
    });
  }

  private render(state: StatusBarState): void {
    this.el.setText(formatIndexingLabel(state));
  }
}
