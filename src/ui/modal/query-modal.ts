import {
  App,
  Modal,
  MarkdownRenderer,
  Component,
  Notice,
} from "obsidian";
import type { KnowledgeBase } from "../../core/kb.js";
import type { LLMProvider } from "../../llm/provider.js";
import { QueryController } from "./query-controller.js";
import { AnswerRenderer, type RenderTarget } from "./answer-renderer.js";
import type { RetrievedBundle } from "../../query/types.js";

export interface QueryModalArgs {
  app: App;
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folder: string;
  recentQuestions: readonly string[];
  onAnswered: (entry: {
    question: string;
    answer: string;
    bundle: RetrievedBundle;
    elapsedMs: number;
  }) => void;
  embeddingIndex?: ReadonlyMap<string, number[]>;
  queryEmbedding?: number[] | null;
}

export class QueryModal extends Modal {
  private inputEl!: HTMLInputElement;
  private answerEl!: HTMLDivElement;
  private sourcesEl!: HTMLDetailsElement;
  private statusEl!: HTMLDivElement;
  private renderer!: AnswerRenderer;
  private controller!: QueryController;
  private currentAnswer = "";
  private currentBundle: RetrievedBundle | null = null;
  private startMs = 0;
  private recentIdx = -1;
  private readonly mdComponent = new Component();

  constructor(private readonly args: QueryModalArgs) {
    super(args.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-wiki-query-modal");

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "Ask your knowledge base…",
      cls: "llm-wiki-query-input",
    });
    this.inputEl.focus();

    const pills = contentEl.createDiv({ cls: "llm-wiki-query-pills" });
    pills.createSpan({ text: `model: ${this.args.model}` });
    pills.createSpan({
      text: `folder: ${this.args.folder || "(whole vault)"}`,
    });

    this.answerEl = contentEl.createDiv({ cls: "llm-wiki-query-answer" });

    this.sourcesEl = contentEl.createEl("details", {
      cls: "llm-wiki-query-sources",
    });
    this.sourcesEl.createEl("summary", { text: "Sources used (0)" });

    this.statusEl = contentEl.createDiv({ cls: "llm-wiki-query-status" });

    const actions = contentEl.createDiv({ cls: "llm-wiki-query-actions" });
    actions.createEl("button", { text: "↻ Re-ask" }).onclick = (): void => {
      if (this.inputEl.value.trim()) this.submit();
    };
    actions.createEl("button", { text: "✕ Close" }).onclick = (): void =>
      this.close();

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

    this.controller = new QueryController({
      kb: this.args.kb,
      provider: this.args.provider,
      model: this.args.model,
      folder: this.args.folder,
      embeddingIndex: this.args.embeddingIndex,
      queryEmbedding: this.args.queryEmbedding,
      onState: (s): void => {
        this.statusEl.setText(s);
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
        const list = this.sourcesEl.createEl("ul");
        for (const s of bundle.sources) {
          list.createEl("li", { text: s.id });
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

    this.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (this.recentIdx + 1 < this.args.recentQuestions.length) {
          this.recentIdx++;
          this.inputEl.value = this.args.recentQuestions[this.recentIdx]!;
        }
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (this.recentIdx > 0) {
          this.recentIdx--;
          this.inputEl.value = this.args.recentQuestions[this.recentIdx]!;
        }
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.close();
      }
    });
  }

  private submit(): void {
    const q = this.inputEl.value.trim();
    if (!q) return;
    this.currentAnswer = "";
    this.currentBundle = null;
    this.renderer.reset();
    this.answerEl.empty();
    this.sourcesEl.querySelector("ul")?.remove();
    this.startMs = Date.now();
    void this.controller.run(q);
  }

  onClose(): void {
    this.controller.cancel();
    this.renderer.flush();
    this.mdComponent.unload();
    this.contentEl.empty();
  }
}
