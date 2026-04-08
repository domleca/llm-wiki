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
import type { RetrievedBundle } from "../../query/types.js";
import type {
  EmbeddingIndexController,
  EmbeddingIndexState,
} from "../../query/embedding-index-controller.js";
import { formatIndexingStatus } from "./indexing-status.js";
import { openModelPicker } from "./model-picker.js";
import { buildOllamaHintFragment } from "./ollama-hint.js";
import {
  ollamaPingStateFromBool,
  renderOllamaPill,
  type OllamaPingState,
} from "./ollama-status-pill.js";
import type { Chat, ChatTurn } from "../../chat/types.js";
import {
  createChat,
  appendTurn,
  updateChatTitle,
  deleteChat,
} from "../../chat/store.js";
import { generateChatId } from "../../chat/id.js";
import { generateChatTitle } from "../../chat/title.js";
import { ChatTranscript, type TurnHandle } from "./chat-transcript.js";
import { ChatList } from "./chat-list.js";

export interface QueryModalArgs {
  app: App;
  kb: KnowledgeBase;
  provider: LLMProvider;
  model: string;
  folder: string;
  chats: readonly Chat[];
  activeChatId: string | null;
  onChatsChanged: (chats: readonly Chat[]) => void;
  onModelChanged: (model: string) => void;
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
  private terminalTextEl!: HTMLSpanElement;
  private controller: QueryController | null = null;

  // Per-turn streaming state
  private currentStreamedAnswer = "";
  private currentSourceIds: string[] = [];
  private currentRewrittenQuery = "";
  private currentBundle: RetrievedBundle | null = null;
  private startMs = 0;
  private firstChunkMs = 0;
  private lastSubmittedQuestion = "";
  private currentHandle: TurnHandle | null = null;

  private chats: readonly Chat[];
  private activeChatId: string | null;
  private currentModel!: string;
  private modelPillEl: HTMLSpanElement | null = null;

  private readonly mdComponent = new Component();
  private unsubscribeIndex: (() => void) | null = null;
  private ollamaPillEl: HTMLSpanElement | null = null;
  private ollamaPingState: OllamaPingState = "unknown";
  private ollamaPingTimer: number | null = null;
  private chatList!: ChatList;
  private transcript!: ChatTranscript;

  /** How often to re-check Ollama liveness while the modal is open. */
  private static readonly OLLAMA_PING_INTERVAL_MS = 2_000;

  constructor(private readonly args: QueryModalArgs) {
    super(args.app);
    this.chats = args.chats;
    this.activeChatId = args.activeChatId;
    this.currentModel = args.model;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-wiki-query-modal");
    contentEl.setAttr("data-state", "idle");
    this.modalEl.addClass("llm-wiki-query-modal");

    // Markdown renderer helper
    const renderMarkdown = (el: HTMLElement, md: string): void => {
      if (
        "empty" in el &&
        typeof (el as { empty?: () => void }).empty === "function"
      ) {
        (el as { empty: () => void }).empty();
      } else {
        el.innerHTML = "";
      }
      void MarkdownRenderer.render(this.app, md, el, "", this.mdComponent);
    };

    // Transcript (above input)
    const transcriptEl = contentEl.createDiv({
      cls: "llm-wiki-query-transcript",
    });
    this.transcript = new ChatTranscript(transcriptEl, { renderMarkdown });

    // Full-width input with inline clear button
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
      this.inputEl.focus();
    };

    // Pills row
    const pills = contentEl.createDiv({ cls: "llm-wiki-query-pills" });
    this.modelPillEl = pills.createSpan({
      cls: "llm-wiki-query-pill llm-wiki-query-pill-clickable",
      text: `model: ${this.currentModel}`,
      attr: { "aria-label": "Change Ollama model", role: "button" },
    });
    this.modelPillEl.onclick = (): void => this.handleModelPillClick();
    this.ollamaPillEl = pills.createSpan({
      cls: "llm-wiki-query-pill llm-wiki-query-pill-ollama",
    });
    this.ollamaPillEl.style.display = "none";
    this.ollamaPillEl.onclick = (): void => this.handleOllamaPillClick();
    pills.createSpan({
      cls: "llm-wiki-query-pill",
      text: `folder: ${this.args.folder || "(whole vault)"}`,
    });

    // Terminal-style status line
    const terminal = contentEl.createDiv({ cls: "llm-wiki-query-terminal" });
    this.terminalTextEl = terminal.createSpan({
      cls: "llm-wiki-query-terminal-text",
    });
    terminal.createSpan({ cls: "llm-wiki-query-cursor" });

    // Chat list (below terminal)
    const chatListEl = contentEl.createDiv({ cls: "llm-wiki-query-chat-list" });
    this.chatList = new ChatList(chatListEl, {
      onPick: (id) => this.pickChat(id),
      onRename: (id, title) => this.handleRename(id, title),
      onDelete: (id) => this.handleDelete(id),
    });
    this.chatList.render(this.chats, this.activeChatId);

    // If there's an active chat, render its turns
    if (this.activeChatId) {
      const active = this.chats.find((c) => c.id === this.activeChatId);
      if (active) this.transcript.renderChat(active);
    }

    // Keyboard hints
    const footer = contentEl.createDiv({ cls: "prompt-instructions" });
    this.appendInstruction(footer, "↑↓", "to navigate");
    this.appendInstruction(footer, "↩", "to use");
    this.appendInstruction(footer, "esc", "to dismiss");

    // Input wiring
    this.inputEl.addEventListener("input", () => {
      this.updateClearVisibility();
    });

    this.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        const selectedId = this.chatList.getSelectedId();
        if (selectedId !== null && this.inputEl.value.trim() === "") {
          this.pickChat(selectedId);
        } else {
          this.submit();
        }
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        this.chatList.moveSelection(1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        this.chatList.moveSelection(-1);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.close();
      }
    });

    // Embedding index subscription
    this.unsubscribeIndex = this.args.indexController.subscribe((s) =>
      this.applyIndexState(s),
    );
    this.applyIndexState(this.args.indexController.getState());
    void this.args.indexController.ensureBuilt();

    // Ollama liveness probe
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
    if (!this.ollamaPillEl) return;
    this.ollamaPingState = ollamaPingStateFromBool(reachable);
    const { visible, text } = renderOllamaPill(this.ollamaPingState);
    this.ollamaPillEl.style.display = visible ? "" : "none";
    if (visible) this.ollamaPillEl.setText(text);
  }

  private handleModelPillClick(): void {
    void openModelPicker({
      app: this.args.app,
      provider: this.args.provider,
      current: this.currentModel,
      onPick: (model) => {
        this.currentModel = model;
        if (this.modelPillEl) this.modelPillEl.setText(`model: ${model}`);
        this.controller?.setModel(model);
        this.args.onModelChanged(model);
      },
    });
  }

  private handleOllamaPillClick(): void {
    const fragment = buildOllamaHintFragment({
      doc: document,
      onCopy: (cmd) => {
        void navigator.clipboard?.writeText(cmd);
      },
    });
    new Notice(fragment, 15_000);
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
    const index: ReadonlyMap<string, number[]> =
      state.kind === "ready" ? state.index : new Map();
    if (!this.controller) {
      this.controller = this.buildQueryController(index);
    }
    if (state.kind === "error" && state.reason === "connect") {
      this.ollamaPingState = ollamaPingStateFromBool(false);
      if (this.ollamaPillEl) {
        const r = renderOllamaPill(this.ollamaPingState);
        this.ollamaPillEl.style.display = r.visible ? "" : "none";
        if (r.visible) this.ollamaPillEl.setText(r.text);
      }
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
    this.applyState("idle");
    this.inputEl.focus();
  }

  private buildQueryController(
    embeddingIndex: ReadonlyMap<string, number[]>,
  ): QueryController {
    return new QueryController({
      kb: this.args.kb,
      provider: this.args.provider,
      model: this.currentModel,
      folder: this.args.folder,
      embeddingIndex,
      queryEmbedding: this.args.queryEmbedding,
      onState: (s): void => {
        this.applyState(s);
        if (s === "done") {
          void this.finalizeTurn();
        }
      },
      onContext: (bundle): void => {
        this.currentBundle = bundle;
        this.currentSourceIds = bundle.sources.map((src) => src.id);
        this.currentHandle?.setSources(this.currentSourceIds);
      },
      onChunk: (t): void => {
        if (this.firstChunkMs === 0) this.firstChunkMs = Date.now();
        this.currentStreamedAnswer += t;
        this.currentHandle?.appendAnswerChunk(t);
      },
      onError: (msg): void => {
        new Notice(`Query failed: ${msg}`);
      },
      onRetrievalQuery: (q): void => {
        this.currentRewrittenQuery = q;
      },
    });
  }

  private ensureActiveChat(): Chat {
    if (this.activeChatId) {
      const existing = this.chats.find((c) => c.id === this.activeChatId);
      if (existing) return existing;
    }
    const now = Date.now();
    const fresh = createChat({
      id: generateChatId(),
      now,
      folder: this.args.folder,
      model: this.currentModel,
    });
    this.chats = [fresh, ...this.chats];
    this.activeChatId = fresh.id;
    this.args.onChatsChanged(this.chats);
    this.chatList.render(this.chats, this.activeChatId);
    return fresh;
  }

  private submit(): void {
    if (!this.controller) return;
    const q = this.inputEl.value.trim();
    if (!q) return;

    const chat = this.ensureActiveChat();

    this.currentHandle = this.transcript.beginTurn(q);
    this.currentStreamedAnswer = "";
    this.currentSourceIds = [];
    this.currentRewrittenQuery = q;
    this.startMs = Date.now();
    this.firstChunkMs = 0;
    this.currentBundle = null;
    this.lastSubmittedQuestion = q;

    void this.controller.runChatTurn({ chat, question: q });

    this.inputEl.value = "";
    this.updateClearVisibility();
  }

  private async finalizeTurn(): Promise<void> {
    const chat = this.activeChatId
      ? this.chats.find((c) => c.id === this.activeChatId)
      : null;
    if (!chat) {
      this.currentHandle?.finalize();
      this.currentHandle = null;
      return;
    }

    const turn: ChatTurn = {
      question: this.lastSubmittedQuestion,
      answer: this.currentStreamedAnswer,
      sourceIds: this.currentSourceIds,
      rewrittenQuery:
        this.currentRewrittenQuery !== this.lastSubmittedQuestion
          ? this.currentRewrittenQuery
          : null,
      createdAt: Date.now(),
    };

    const updatedChat = appendTurn(chat, turn, Date.now());
    this.chats = this.chats.map((c) => (c.id === updatedChat.id ? updatedChat : c));
    this.args.onChatsChanged(this.chats);
    this.chatList.render(this.chats, this.activeChatId);

    this.currentHandle?.finalize();
    this.currentHandle = null;

    if (this.currentBundle) {
      this.args.onAnswered({
        question: this.lastSubmittedQuestion,
        answer: this.currentStreamedAnswer,
        bundle: this.currentBundle,
        elapsedMs: Date.now() - this.startMs,
      });
    }

    if (updatedChat.turns.length === 1) {
      void this.runTitleGeneration(updatedChat);
    }
  }

  private async runTitleGeneration(chat: Chat): Promise<void> {
    try {
      const title = await generateChatTitle({
        provider: this.args.provider,
        model: this.currentModel,
        firstTurn: chat.turns[0]!,
      });
      const updated = updateChatTitle(chat, title, Date.now());
      this.chats = this.chats.map((c) => (c.id === updated.id ? updated : c));
      this.args.onChatsChanged(this.chats);
      this.chatList.render(this.chats, this.activeChatId);
    } catch {
      // Title generation failure must not crash the modal
    }
  }

  private pickChat(id: string): void {
    const chat = this.chats.find((c) => c.id === id);
    if (!chat) return;
    this.activeChatId = id;
    this.chatList.render(this.chats, id);
    this.transcript.renderChat(chat);
    this.inputEl.focus();
  }

  private handleRename(id: string, newTitle: string): void {
    const chat = this.chats.find((c) => c.id === id);
    if (!chat) return;
    const updated = updateChatTitle(chat, newTitle, Date.now());
    this.chats = this.chats.map((c) => (c.id === updated.id ? updated : c));
    this.args.onChatsChanged(this.chats);
    this.chatList.render(this.chats, this.activeChatId);
  }

  private handleDelete(id: string): void {
    this.chats = deleteChat(this.chats, id);
    if (this.activeChatId === id) {
      this.activeChatId = null;
      this.transcript.clear();
    }
    this.args.onChatsChanged(this.chats);
    this.chatList.render(this.chats, this.activeChatId);
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
        const endMs = this.firstChunkMs || Date.now();
        const secs = ((endMs - this.startMs) / 1000).toFixed(1);
        return `done in ${secs}s`;
      }
      case "error":
        return "error — see notice";
      case "cancelled":
        return "cancelled";
    }
  }

  private updateClearVisibility(): void {
    this.clearBtn.setAttr(
      "data-visible",
      this.inputEl.value.length > 0 ? "true" : "false",
    );
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
