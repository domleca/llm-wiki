import {
  App,
  Modal,
  MarkdownRenderer,
  Component,
  Notice,
  setIcon,
} from "obsidian";
import type { KnowledgeBase } from "../../core/kb.js";
import type { LLMProvider } from "../../llm/provider.js";
import {
  QueryController,
  type QueryControllerState,
} from "./query-controller.js";
import { AnswerRenderer, type RenderTarget } from "./answer-renderer.js";
import type { RetrievedBundle } from "../../query/types.js";
import type {
  EmbeddingIndexController,
  EmbeddingIndexState,
} from "../../query/embedding-index-controller.js";
import { formatIndexingStatus } from "./indexing-status.js";
import { buildOllamaHintFragment } from "./ollama-hint.js";
import {
  ollamaPingStateFromBool,
  renderOllamaPill,
  type OllamaPingState,
} from "./ollama-status-pill.js";

const MAX_RECENTS_DISPLAYED = 5;

export interface QueryModalArgs {
  app: App;
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folder: string;
  recentQuestions: readonly string[];
  indexController: EmbeddingIndexController;
  queryEmbedding?: number[] | null;
  onAnswered: (entry: {
    question: string;
    answer: string;
    bundle: RetrievedBundle;
    elapsedMs: number;
  }) => void;
}

export class QueryModal extends Modal {
  private inputEl!: HTMLInputElement;
  private clearBtn!: HTMLButtonElement;
  private answerEl!: HTMLDivElement;
  private sourcesEl!: HTMLDetailsElement;
  private terminalTextEl!: HTMLSpanElement;
  private recentsEl!: HTMLDivElement;
  private recentItemEls: HTMLDivElement[] = [];
  private renderer!: AnswerRenderer;
  private controller: QueryController | null = null;
  private currentAnswer = "";
  private currentBundle: RetrievedBundle | null = null;
  private startMs = 0;
  private selectedRecentIdx = -1;
  private readonly recents: readonly string[];
  private readonly mdComponent = new Component();
  private unsubscribeIndex: (() => void) | null = null;
  private ollamaPillEl: HTMLSpanElement | null = null;
  private ollamaPingState: OllamaPingState = "unknown";
  private ollamaPingTimer: number | null = null;
  /** How often to re-check Ollama liveness while the modal is open. */
  private static readonly OLLAMA_PING_INTERVAL_MS = 10_000;

  constructor(private readonly args: QueryModalArgs) {
    super(args.app);
    this.recents = args.recentQuestions.slice(0, MAX_RECENTS_DISPLAYED);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-wiki-query-modal");
    contentEl.setAttr("data-state", "idle");
    this.modalEl.addClass("llm-wiki-query-modal");

    // Full-width input with inline clear button. Matches the command-palette
    // look without inheriting Obsidian's prompt-input sizing constraints.
    const inputContainer = contentEl.createDiv({
      cls: "llm-wiki-query-input-container",
    });
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: "Ask your knowledge base…",
      cls: "llm-wiki-query-input",
    });
    this.clearBtn = inputContainer.createEl("button", {
      cls: "llm-wiki-query-clear",
      attr: { type: "button", "aria-label": "Clear" },
    });
    setIcon(this.clearBtn, "x");
    this.clearBtn.onclick = (ev): void => {
      ev.preventDefault();
      this.inputEl.value = "";
      this.updateClearVisibility();
      this.clearRecentSelection();
      this.inputEl.focus();
    };

    // Pills row
    const pills = contentEl.createDiv({ cls: "llm-wiki-query-pills" });
    pills.createSpan({
      cls: "llm-wiki-query-pill",
      text: `model: ${this.args.model}`,
    });
    // Ollama liveness pill — sits between model and folder so it doesn't
    // shift the existing pills around when it appears. Hidden until the
    // first ping reports `off`.
    this.ollamaPillEl = pills.createSpan({
      cls: "llm-wiki-query-pill llm-wiki-query-pill-ollama",
    });
    this.ollamaPillEl.style.display = "none";
    this.ollamaPillEl.onclick = (): void => this.handleOllamaPillClick();
    pills.createSpan({
      cls: "llm-wiki-query-pill",
      text: `folder: ${this.args.folder || "(whole vault)"}`,
    });

    // Recent questions — full-width suggestion rows, no header/container
    this.recentsEl = contentEl.createDiv({ cls: "llm-wiki-query-recents" });
    this.recents.forEach((q, i) => {
      const item = this.recentsEl.createDiv({
        cls: "suggestion-item llm-wiki-query-recent-item",
        text: q,
      });
      item.onclick = (): void => {
        this.inputEl.value = q;
        this.selectedRecentIdx = i;
        this.refreshRecentHighlight();
        this.submit();
      };
      this.recentItemEls.push(item);
    });

    // Terminal-style status line
    const terminal = contentEl.createDiv({ cls: "llm-wiki-query-terminal" });
    this.terminalTextEl = terminal.createSpan({
      cls: "llm-wiki-query-terminal-text",
    });
    terminal.createSpan({ cls: "llm-wiki-query-cursor" });

    // Answer + sources
    this.answerEl = contentEl.createDiv({ cls: "llm-wiki-query-answer" });
    this.sourcesEl = contentEl.createEl("details", {
      cls: "llm-wiki-query-sources",
    });
    this.sourcesEl.setAttr("data-empty", "true");
    this.sourcesEl.createEl("summary", { text: "Sources used (0)" });

    // Keyboard hints — uses Obsidian's native .prompt-instructions classes
    const footer = contentEl.createDiv({ cls: "prompt-instructions" });
    this.appendInstruction(footer, "↑↓", "to navigate");
    this.appendInstruction(footer, "↩", "to use");
    this.appendInstruction(footer, "esc", "to dismiss");

    // Markdown rendering pipeline
    const renderTarget: RenderTarget = {
      setMarkdown: (md): void => {
        this.answerEl.empty();
        void MarkdownRenderer.render(
          this.app,
          md,
          this.answerEl,
          "",
          this.mdComponent,
        );
      },
    };
    this.renderer = new AnswerRenderer(renderTarget, { debounceMs: 50 });

    // Input wiring
    this.inputEl.addEventListener("input", () => {
      this.updateClearVisibility();
      this.clearRecentSelection();
    });

    this.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        this.moveRecentSelection(1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        this.moveRecentSelection(-1);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.close();
      }
    });

    // Embedding index — subscribe first so the closed-modal guard works,
    // then render the current state, then kick off the build.
    this.unsubscribeIndex = this.args.indexController.subscribe((s) =>
      this.applyIndexState(s),
    );
    this.applyIndexState(this.args.indexController.getState());
    void this.args.indexController.ensureBuilt();

    // Kick off Ollama liveness probe + periodic re-check.
    void this.pingOllama();
    this.ollamaPingTimer = window.setInterval(
      () => void this.pingOllama(),
      QueryModal.OLLAMA_PING_INTERVAL_MS,
    );
  }

  private async pingOllama(): Promise<void> {
    let reachable = false;
    try {
      reachable = await this.args.provider.ping();
    } catch {
      reachable = false;
    }
    // Modal might have closed mid-flight.
    if (!this.ollamaPillEl) return;
    this.ollamaPingState = ollamaPingStateFromBool(reachable);
    const { visible, text } = renderOllamaPill(this.ollamaPingState);
    this.ollamaPillEl.style.display = visible ? "" : "none";
    if (visible) this.ollamaPillEl.setText(text);
  }

  private handleOllamaPillClick(): void {
    const fragment = buildOllamaHintFragment({
      doc: document,
      onCopy: (cmd) => {
        void navigator.clipboard?.writeText(cmd);
      },
    });
    new Notice(fragment, 15_000);
    // Re-ping shortly after — gives the user a moment to start Ollama and
    // see the pill flip back to hidden without waiting for the next tick.
    window.setTimeout(() => void this.pingOllama(), 1500);
  }

  private applyIndexState(state: EmbeddingIndexState): void {
    if (!this.unsubscribeIndex) return; // modal already closed
    if (state.kind === "idle" || state.kind === "building") {
      this.contentEl.setAttr("data-state", "indexing");
      this.terminalTextEl.setText(formatIndexingStatus(state));
      this.terminalTextEl.removeClass("llm-wiki-query-terminal-clickable");
      this.terminalTextEl.onclick = null;
      this.inputEl.setAttr("disabled", "true");
      return;
    }
    // state.kind === "ready" | "error" — either way we hand the modal a usable
    // (possibly empty) embedding index so keyword-only retrieval keeps working.
    const index: ReadonlyMap<string, number[]> =
      state.kind === "ready" ? state.index : new Map();
    if (!this.controller) {
      this.controller = this.buildQueryController(index);
    }
    if (state.kind === "error" && state.reason === "connect") {
      // Connect errors are recoverable: keep the status visible and clickable
      // so the user can start Ollama and click to retry. Input still becomes
      // enabled so keyword-only retrieval works in the meantime.
      this.contentEl.setAttr("data-state", "indexing");
      this.terminalTextEl.setText(formatIndexingStatus(state));
      this.terminalTextEl.addClass("llm-wiki-query-terminal-clickable");
      this.terminalTextEl.onclick = (): void => {
        const fragment = buildOllamaHintFragment({
          doc: document,
          onCopy: (cmd) => {
            void navigator.clipboard?.writeText(cmd);
          },
        });
        // 15s — long enough to read both commands and click a copy button.
        new Notice(fragment, 15_000);
        void this.args.indexController.retry();
      };
      this.inputEl.removeAttribute("disabled");
      this.inputEl.focus();
      return;
    }
    if (state.kind === "error") {
      new Notice(
        `LLM Wiki: embedding index unavailable (${state.message}) — keyword-only retrieval`,
      );
    }
    this.terminalTextEl.removeClass("llm-wiki-query-terminal-clickable");
    this.terminalTextEl.onclick = null;
    // Hand off the terminal line to the query-controller state machine.
    this.applyState("idle");
    this.inputEl.focus();
  }

  private buildQueryController(
    embeddingIndex: ReadonlyMap<string, number[]>,
  ): QueryController {
    return new QueryController({
      kb: this.args.kb,
      provider: this.args.provider,
      model: this.args.model,
      folder: this.args.folder,
      embeddingIndex,
      queryEmbedding: this.args.queryEmbedding,
      onState: (s): void => {
        this.applyState(s);
        if (s === "done" && this.currentBundle) {
          this.args.onAnswered({
            question: this.inputEl.value,
            answer: this.currentAnswer,
            bundle: this.currentBundle,
            elapsedMs: Date.now() - this.startMs,
          });
        }
      },
      onContext: (bundle): void => {
        this.currentBundle = bundle;
        const summary = this.sourcesEl.querySelector("summary");
        if (summary) {
          summary.setText(`Sources used (${bundle.sources.length})`);
        }
        this.sourcesEl.querySelector("ul")?.remove();
        if (bundle.sources.length > 0) {
          this.sourcesEl.setAttr("data-empty", "false");
          const list = this.sourcesEl.createEl("ul");
          for (const s of bundle.sources) {
            list.createEl("li", { text: s.id });
          }
        } else {
          this.sourcesEl.setAttr("data-empty", "true");
        }
      },
      onChunk: (t): void => {
        this.currentAnswer += t;
        this.renderer.append(t);
      },
      onError: (msg): void => {
        new Notice(`Query failed: ${msg}`);
      },
    });
  }

  private submit(): void {
    if (!this.controller) return;
    const q = this.inputEl.value.trim();
    if (!q) return;
    this.currentAnswer = "";
    this.currentBundle = null;
    this.renderer.reset();
    this.answerEl.empty();
    this.sourcesEl.setAttr("data-empty", "true");
    this.sourcesEl.querySelector("ul")?.remove();
    const summary = this.sourcesEl.querySelector("summary");
    if (summary) summary.setText("Sources used (0)");
    this.startMs = Date.now();
    void this.controller.run(q);
  }

  private applyState(s: QueryControllerState): void {
    this.contentEl.setAttr("data-state", s);
    this.terminalTextEl.setText(this.terminalLabel(s));
    if (s === "loading" || s === "streaming") {
      this.inputEl.setAttr("disabled", "true");
    } else {
      this.inputEl.removeAttribute("disabled");
      if (s === "done" || s === "error" || s === "cancelled") {
        this.inputEl.focus();
      }
    }
  }

  private terminalLabel(s: QueryControllerState): string {
    switch (s) {
      case "idle":
        return "";
      case "loading":
        return "thinking";
      case "streaming":
        return "streaming";
      case "done": {
        const secs = ((Date.now() - this.startMs) / 1000).toFixed(1);
        return `done in ${secs}s`;
      }
      case "error":
        return "error — see notice";
      case "cancelled":
        return "cancelled";
    }
  }

  private moveRecentSelection(delta: number): void {
    if (this.recents.length === 0) return;
    const next =
      this.selectedRecentIdx === -1
        ? delta > 0
          ? 0
          : this.recents.length - 1
        : this.selectedRecentIdx + delta;
    if (next < 0 || next >= this.recents.length) return;
    this.selectedRecentIdx = next;
    this.inputEl.value = this.recents[next]!;
    this.updateClearVisibility();
    this.refreshRecentHighlight();
    this.recentItemEls[next]?.scrollIntoView({ block: "nearest" });
  }

  private updateClearVisibility(): void {
    this.clearBtn.setAttr(
      "data-visible",
      this.inputEl.value.length > 0 ? "true" : "false",
    );
  }

  private clearRecentSelection(): void {
    if (this.selectedRecentIdx === -1) return;
    this.selectedRecentIdx = -1;
    this.refreshRecentHighlight();
  }

  private refreshRecentHighlight(): void {
    this.recentItemEls.forEach((el, i) => {
      el.toggleClass("is-selected", i === this.selectedRecentIdx);
    });
  }

  private appendInstruction(
    parent: HTMLElement,
    cmd: string,
    text: string,
  ): void {
    const instruction = parent.createDiv({ cls: "prompt-instruction" });
    instruction.createSpan({
      cls: "prompt-instruction-command",
      text: cmd,
    });
    instruction.createSpan({ text });
  }

  onClose(): void {
    this.controller?.cancel();
    this.renderer.flush();
    this.mdComponent.unload();
    this.unsubscribeIndex?.();
    this.unsubscribeIndex = null;
    if (this.ollamaPingTimer !== null) {
      window.clearInterval(this.ollamaPingTimer);
      this.ollamaPingTimer = null;
    }
    this.ollamaPillEl = null;
    this.contentEl.empty();
  }
}
