import {
  App,
  Modal,
  MarkdownRenderer,
  Component,
  Notice,
  setIcon,
  TFolder,
} from "obsidian";
import type { KnowledgeBase } from "../../core/kb.js";
import type { LLMProvider } from "../../llm/provider.js";
import {
  QueryController,
  type QueryControllerState,
} from "./query-controller.js";
import type { RetrievedBundle, ScoredSource } from "../../query/types.js";
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
import { groundSources } from "../../query/ground-sources.js";

export interface QueryModalArgs {
  app: App;
  kb: KnowledgeBase;
  provider: LLMProvider;
  /** Human label for the active provider (e.g. "ollama", "openai"). */
  providerLabel: string;
  /**
   * When the completion provider has no embedding support (Anthropic),
   * this is the local Ollama provider used for embeddings. The query
   * modal pings it separately so the status pill can warn if Ollama is
   * down even though the cloud API is fine.
   */
  embedFallbackProvider?: LLMProvider;
  model: string;
  folders: string[];
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

/**
 * Rank source files by relevance to the query.
 *
 * Two signals matter:
 * 1. **Item rank** — the bundle's entity/concept arrays are sorted by retrieval
 *    score (best first). A source from entity #1 is weighted more than one from
 *    entity #8. Weight per source also decays within each item's source list
 *    (capped at MAX_SOURCES_PER_ITEM) so an entity mentioned in 20 files
 *    doesn't flood the results with passing mentions.
 * 2. **Cross-citation** — a file cited by multiple retrieved items is almost
 *    certainly relevant. After scoring, we apply a multiplier based on how
 *    many distinct items cited each source.
 *
 * Connections contribute a flat small bonus (they carry no inherent ranking).
 * Returns a scored map so callers can accumulate across turns.
 */
const MAX_PILL_LABEL = 28;

function pillLabel(prefix: string, value: string): string {
  if (value.length > MAX_PILL_LABEL) {
    return `${prefix}: ${value.slice(0, MAX_PILL_LABEL)}…`;
  }
  return `${prefix}: ${value}`;
}

const MAX_RANKED_SOURCES = 15;
const MAX_SOURCES_PER_ITEM = 5;

export type { ScoredSource } from "../../query/types.js";

function rankSourcesByRelevance(bundle: RetrievedBundle): ScoredSource[] {
  const scores = new Map<string, number>();
  // Track how many distinct items (entities/concepts/connections) cite each source
  const citations = new Map<string, number>();

  const add = (
    paths: readonly string[],
    weight: number,
    cap: number,
  ): void => {
    const limited = paths.slice(0, cap);
    for (let j = 0; j < limited.length; j++) {
      const p = limited[j]!;
      // Decay within the source list: first source gets full weight,
      // subsequent ones get progressively less (1.0, 0.67, 0.5, 0.4, …)
      const intraWeight = weight / (j * 0.5 + 1);
      scores.set(p, (scores.get(p) ?? 0) + intraWeight);
    }
    // Count one citation per item for each unique source
    const seen = new Set<string>();
    for (const p of limited) {
      if (!seen.has(p)) {
        citations.set(p, (citations.get(p) ?? 0) + 1);
        seen.add(p);
      }
    }
  };

  // Entities are sorted best-first; weight decays with rank.
  for (let i = 0; i < bundle.entities.length; i++) {
    add(bundle.entities[i]!.sources, 1 / (i + 1), MAX_SOURCES_PER_ITEM);
  }
  // Same for concepts.
  for (let i = 0; i < bundle.concepts.length; i++) {
    add(bundle.concepts[i]!.sources, 1 / (i + 1), MAX_SOURCES_PER_ITEM);
  }
  // Connections get a small flat bonus.
  for (const conn of bundle.connections) {
    add(conn.sources, 0.1, MAX_SOURCES_PER_ITEM);
  }

  // Cross-citation boost: sources cited by 2+ items get a multiplier.
  // 1 item → 1x, 2 items → 1.5x, 3 items → 2x, etc.
  for (const [path, count] of citations) {
    if (count > 1) {
      const current = scores.get(path) ?? 0;
      scores.set(path, current * (1 + (count - 1) * 0.5));
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RANKED_SOURCES)
    .map(([id, score]) => ({ id, score }));
}

export class QueryModal extends Modal {
  private inputEl!: HTMLInputElement;
  private clearBtn!: HTMLButtonElement;
  private terminalTextEl!: HTMLSpanElement;
  private controller: QueryController | null = null;

  // Per-turn streaming state
  private currentStreamedAnswer = "";
  private currentScoredSources: ScoredSource[] = [];
  private currentRewrittenQuery = "";
  private currentBundle: RetrievedBundle | null = null;
  private startMs = 0;
  private firstChunkMs = 0;
  private lastSubmittedQuestion = "";
  private currentHandle: TurnHandle | null = null;
  private currentSourceCount = 0;

  private chats: readonly Chat[];
  private activeChatId: string | null;
  private currentModel!: string;
  private currentFolders!: string[];
  private modelPillEl: HTMLSpanElement | null = null;
  private folderPillEl: HTMLSpanElement | null = null;

  private readonly mdComponent = new Component();
  private unsubscribeIndex: (() => void) | null = null;
  private ollamaPillEl: HTMLSpanElement | null = null;
  private ollamaPingState: OllamaPingState = "unknown";
  private ollamaPingTimer: number | null = null;
  private chatList!: ChatList;
  private transcript!: ChatTranscript;
  private footerEl!: HTMLDivElement;

  /** How often to re-check Ollama liveness while the modal is open. */
  private static readonly OLLAMA_PING_INTERVAL_MS = 2_000;

  constructor(private readonly args: QueryModalArgs) {
    super(args.app);
    this.chats = args.chats;
    this.activeChatId = args.activeChatId;
    this.currentModel = args.model;
    this.currentFolders = args.folders;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-wiki-query-modal");
    contentEl.setAttr("data-state", "idle");
    // Picker mode shows the history list; chat mode hides it and pins the
    // input at the bottom. Always start in picker mode — reopening the modal
    // is the user's way of "getting back to history".
    contentEl.setAttr("data-mode", "picker");
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
    this.transcript = new ChatTranscript(transcriptEl, { app: this.app, renderMarkdown });

    // Full-width input with inline clear button
    const inputContainer = contentEl.createDiv({
      cls: "llm-wiki-query-input-container",
    });
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: "Ask your knowledge base\u2026",
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
      text: pillLabel("model", this.currentModel),
      attr: { "aria-label": "Change model", role: "button" },
    });
    this.modelPillEl.onclick = (): void => this.handleModelPillClick();
    this.ollamaPillEl = pills.createSpan({
      cls: "llm-wiki-query-pill llm-wiki-query-pill-status",
    });
    this.ollamaPillEl.onclick = (): void => this.handleOllamaPillClick();
    this.folderPillEl = pills.createSpan({
      cls: "llm-wiki-query-pill llm-wiki-query-pill-clickable",
      text: this.getFolderPillText(),
      attr: { "aria-label": "Change folder scope", role: "button" },
    });
    this.folderPillEl.onclick = (): void => this.handleFolderPillClick();

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

    // We always start in picker mode — even if an activeChatId was persisted,
    // the user's expectation is that reopening the modal goes back to the
    // history list, and the most recent chat sits at the top of it.
    this.activeChatId = null;

    // Keyboard hints (hidden in chat mode via CSS)
    this.footerEl = contentEl.createDiv({ cls: "prompt-instructions llm-wiki-query-footer" });
    this.renderFooterHints();

    // Input wiring
    this.inputEl.addEventListener("input", () => {
      this.updateClearVisibility();
      // In picker mode the input doubles as a filter over recent chats so
      // the user can notice "I already asked this" before hitting Enter.
      if (this.contentEl.getAttr("data-mode") !== "chat") {
        const filter = this.inputEl.value.trim();
        // Lock the chat list height while filtering so the modal doesn't
        // shrink and the input stays put. Release when the input is cleared.
        if (filter) {
          if (!chatListEl.style.minHeight) {
            chatListEl.style.minHeight = `${chatListEl.offsetHeight}px`;
          }
        } else {
          chatListEl.style.minHeight = "";
        }
        this.chatList.render(this.chats, this.activeChatId, filter);
      }
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

  /** Tracks which backend is actually down so the click handler shows the right message. */
  private lastPingFailure: "provider" | "embed-fallback" | null = null;

  private async pingOllama(): Promise<void> {
    let mainOk = false;
    try {
      mainOk = await this.args.provider.ping();
    } catch {
      mainOk = false;
    }

    let embedOk = true;
    if (this.args.embedFallbackProvider) {
      try {
        embedOk = await this.args.embedFallbackProvider.ping();
      } catch {
        embedOk = false;
      }
    }

    if (!this.ollamaPillEl) return;

    const allOk = mainOk && embedOk;
    this.lastPingFailure = !mainOk
      ? "provider"
      : !embedOk
        ? "embed-fallback"
        : null;
    this.ollamaPingState = ollamaPingStateFromBool(allOk);
    const { visible, text } = renderOllamaPill(
      this.ollamaPingState,
      this.args.providerLabel,
    );
    this.ollamaPillEl.toggleClass("is-visible", visible);
    if (visible) this.ollamaPillEl.setText(text);
  }

  private handleModelPillClick(): void {
    if (this.activeModelPopover) {
      this.closeModelPopover();
      return;
    }
    void this.openModelPopover();
  }

  private activeModelPopover: HTMLDivElement | null = null;
  private modelPopoverCleanup: (() => void) | null = null;

  private async openModelPopover(): Promise<void> {
    if (!this.args.provider.listModels) {
      new Notice("LLM Wiki: provider does not expose installed models.");
      return;
    }
    const models = await this.args.provider.listModels();
    if (!models || models.length === 0) {
      new Notice("LLM Wiki: no models available.");
      return;
    }

    const pill = this.modelPillEl;
    if (!pill) return;

    const popover = document.createElement("div");
    popover.className = "llm-wiki-model-popover";

    for (const model of models) {
      const row = document.createElement("div");
      row.className = "llm-wiki-model-popover-item";
      const isActive = model === this.currentModel;
      if (isActive) row.classList.add("is-active");
      const label = document.createElement("span");
      label.className = "llm-wiki-model-popover-label";
      label.textContent = model;
      row.appendChild(label);
      if (isActive) {
        const check = document.createElement("span");
        check.className = "llm-wiki-model-popover-check";
        check.textContent = "✓";
        row.appendChild(check);
      }
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.currentModel = model;
        if (this.modelPillEl) this.modelPillEl.setText(pillLabel("model", model));
        this.controller?.setModel(model);
        this.args.onModelChanged(model);
        this.closeModelPopover();
      });
      popover.appendChild(row);
    }

    // Position anchored below the pill
    const rect = pill.getBoundingClientRect();
    const modalRect = this.modalEl.getBoundingClientRect();
    popover.style.top = `${rect.bottom - modalRect.top + 4}px`;
    popover.style.left = `${rect.left - modalRect.left}px`;
    this.modalEl.appendChild(popover);
    this.activeModelPopover = popover;
    this.modalEl.addClass("has-popover");

    // Close on click outside
    const onClickOutside = (ev: MouseEvent): void => {
      if (!popover.contains(ev.target as Node) && ev.target !== pill) {
        this.closeModelPopover();
      }
    };
    window.setTimeout(() => document.addEventListener("click", onClickOutside), 0);
    this.modelPopoverCleanup = () => document.removeEventListener("click", onClickOutside);
  }

  private closeModelPopover(): void {
    this.activeModelPopover?.remove();
    this.activeModelPopover = null;
    this.modelPopoverCleanup?.();
    this.modelPopoverCleanup = null;
    if (!this.activeFolderPopover) this.modalEl.removeClass("has-popover");
  }

  private getFolderPillText(): string {
    if (this.currentFolders.length === 0) {
      return `folder: ${this.app.vault.getName()}`;
    } else if (this.currentFolders.length === 1) {
      return `folder: ${this.currentFolders[0]}`;
    } else {
      return `folder: ${this.currentFolders.length} folders`;
    }
  }

  private updateFolderPill(): void {
    if (this.folderPillEl) {
      this.folderPillEl.setText(this.getFolderPillText());
    }
  }

  private handleFolderPillClick(): void {
    if (this.activeFolderPopover) {
      this.closeFolderPopover();
      return;
    }
    this.openFolderPopover();
  }

  private activeFolderPopover: HTMLDivElement | null = null;
  private folderPopoverCleanup: (() => void) | null = null;

  private openFolderPopover(): void {
    const pill = this.folderPillEl;
    if (!pill) return;

    const vaultName = this.app.vault.getName();
    const folders: string[] = [];
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (f instanceof TFolder && f.path !== "/" && f.path !== "") {
        folders.push(f.path);
      }
    }
    folders.sort((a, b) => a.localeCompare(b));

    const popover = document.createElement("div");
    popover.className = "llm-wiki-model-popover";

    // "All folders" (whole vault) option
    const allRow = document.createElement("div");
    allRow.className = "llm-wiki-model-popover-item";
    if (this.currentFolders.length === 0) allRow.classList.add("is-active");
    const allCheckbox = document.createElement("input");
    allCheckbox.type = "checkbox";
    allCheckbox.checked = this.currentFolders.length === 0;
    const allLabel = document.createElement("span");
    allLabel.textContent = `${vaultName} (all)`;
    allRow.appendChild(allCheckbox);
    allRow.appendChild(allLabel);
    allRow.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.currentFolders = [];
      this.updateFolderPill();
      this.controller?.setFolders(this.currentFolders);
      this.refreshFolderPopover();
    });
    popover.appendChild(allRow);

    // Individual folder options
    for (const folder of folders) {
      const row = document.createElement("div");
      row.className = "llm-wiki-model-popover-item";
      if (this.currentFolders.includes(folder)) row.classList.add("is-active");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.currentFolders.includes(folder);

      const label = document.createElement("span");
      label.textContent = folder;

      row.appendChild(checkbox);
      row.appendChild(label);

      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (this.currentFolders.includes(folder)) {
          this.currentFolders = this.currentFolders.filter((f) => f !== folder);
        } else {
          this.currentFolders = [...this.currentFolders, folder];
        }
        this.updateFolderPill();
        this.controller?.setFolders(this.currentFolders);
        this.refreshFolderPopover();
      });
      popover.appendChild(row);
    }

    const rect = pill.getBoundingClientRect();
    const modalRect = this.modalEl.getBoundingClientRect();
    popover.style.top = `${rect.bottom - modalRect.top + 4}px`;
    popover.style.left = `${rect.left - modalRect.left}px`;
    this.modalEl.appendChild(popover);
    this.activeFolderPopover = popover;
    this.modalEl.addClass("has-popover");

    const onClickOutside = (ev: MouseEvent): void => {
      if (!popover.contains(ev.target as Node) && ev.target !== pill) {
        this.closeFolderPopover();
      }
    };
    window.setTimeout(() => document.addEventListener("click", onClickOutside), 0);
    this.folderPopoverCleanup = () => document.removeEventListener("click", onClickOutside);
  }

  private refreshFolderPopover(): void {
    this.closeFolderPopover();
    this.openFolderPopover();
  }

  private closeFolderPopover(): void {
    this.activeFolderPopover?.remove();
    this.activeFolderPopover = null;
    this.folderPopoverCleanup?.();
    this.folderPopoverCleanup = null;
    if (!this.activeModelPopover) this.modalEl.removeClass("has-popover");
  }

  private handleOllamaPillClick(): void {
    if (
      this.lastPingFailure === "embed-fallback" ||
      this.args.providerLabel === "ollama"
    ) {
      // Ollama is the thing that's down — show the restart commands
      const fragment = buildOllamaHintFragment({
        doc: document,
        onCopy: (cmd) => {
          void navigator.clipboard?.writeText(cmd);
        },
      });
      new Notice(fragment, 15_000);
    } else {
      new Notice(
        `${this.args.providerLabel} is not reachable. Check your API key and network connection.`,
        8_000,
      );
    }
    window.setTimeout(() => void this.pingOllama(), 1500);
  }

  private applyIndexState(state: EmbeddingIndexState): void {
    if (!this.unsubscribeIndex) return; // modal already closed

    // Always create the controller (with an empty index if necessary) so the
    // user can query with keyword-only retrieval while embeddings build.
    if (!this.controller) {
      const index: ReadonlyMap<string, number[]> =
        state.kind === "ready" ? state.index : new Map();
      this.controller = this.buildQueryController(index);
    }

    if (state.kind === "idle" || state.kind === "building") {
      this.contentEl.setAttr("data-state", "indexing");
      this.terminalTextEl.setText(formatIndexingStatus(state));
      this.terminalTextEl.removeClass("llm-wiki-query-terminal-clickable");
      this.terminalTextEl.onclick = null;
      // Input stays enabled — keyword-only retrieval works fine without
      // embeddings. The user shouldn't have to wait for a full index rebuild.
      this.inputEl.removeAttribute("disabled");
      this.inputEl.focus();
      this.renderFooterIndexingWarning();
      return;
    }
    if (state.kind === "error" && state.reason === "connect") {
      this.ollamaPingState = ollamaPingStateFromBool(false);
      if (this.ollamaPillEl) {
        const r = renderOllamaPill(
          this.ollamaPingState,
          this.args.providerLabel,
        );
        this.ollamaPillEl.toggleClass("is-visible", r.visible);
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
    this.renderFooterHints();
    this.inputEl.focus();
  }

  private buildQueryController(
    embeddingIndex: ReadonlyMap<string, number[]>,
  ): QueryController {
    return new QueryController({
      kb: this.args.kb,
      provider: this.args.provider,
      model: this.currentModel,
      folders: this.currentFolders,
      embeddingIndex,
      queryEmbedding: this.args.queryEmbedding,
      onState: (s): void => {
        this.applyState(s);
        if (s === "done") {
          void this.finalizeTurn();
        }
      },
      onContext: (bundle, confidence): void => {
        this.currentBundle = bundle;
        this.currentScoredSources = rankSourcesByRelevance(bundle);
        this.currentSourceCount = bundle.sources.length;
        if (confidence !== "confident") {
          this.currentHandle?.setThinkingText(
            "Uh oh\u2026 few matches in your vault",
          );
        }
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
    const chatFolder = this.currentFolders.length === 1 ? this.currentFolders[0] : "";
    const now = Date.now();
    const fresh = createChat({
      id: generateChatId(),
      now,
      folder: chatFolder,
      model: this.currentModel,
    });
    this.chats = [fresh, ...this.chats];
    this.activeChatId = fresh.id;
    this.args.onChatsChanged(this.chats);
    this.chatList.render(this.chats, this.activeChatId);
    return fresh;
  }

  private enterChatMode(): void {
    this.contentEl.setAttr("data-mode", "chat");
    this.inputEl.placeholder = "Reply\u2026";
    // Footer is useless in chat mode — hide it
    this.footerEl.addClass("is-hidden");
  }

  private submit(): void {
    if (!this.controller) return;
    const q = this.inputEl.value.trim();
    if (!q) return;

    const chat = this.ensureActiveChat();
    this.enterChatMode();

    this.currentHandle = this.transcript.beginTurn(q);
    this.currentStreamedAnswer = "";
    this.currentScoredSources = [];
    this.currentRewrittenQuery = q;
    this.startMs = Date.now();
    this.firstChunkMs = 0;
    this.currentBundle = null;
    this.currentSourceCount = 0;
    this.lastSubmittedQuestion = q;

    void this.controller.runChatTurn({ chat, question: q });

    // Generate a title right away — only needs the question, no need to
    // wait for the answer. Only for the first turn of a new chat.
    if (chat.turns.length === 0) {
      void this.runTitleGeneration(chat, q);
    }

    this.inputEl.value = "";
    this.updateClearVisibility();
  }

  private async finalizeTurn(): Promise<void> {
    const chat = this.activeChatId
      ? this.chats.find((c) => c.id === this.activeChatId)
      : null;

    // Re-score: keep only sources linked to entities/concepts the LLM
    // actually mentioned in its answer.
    if (this.currentBundle && this.currentStreamedAnswer) {
      this.currentScoredSources = groundSources(
        this.currentStreamedAnswer,
        this.currentBundle,
        this.currentScoredSources,
      );
    }

    const sourceIds = this.currentScoredSources.map((s) => s.id);
    if (!chat) {
      this.currentHandle?.setSources(this.currentScoredSources);
      this.currentHandle?.finalize();
      this.currentHandle = null;
      return;
    }

    const turn: ChatTurn = {
      question: this.lastSubmittedQuestion,
      answer: this.currentStreamedAnswer,
      sourceIds,
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

    this.currentHandle?.setSources(this.currentScoredSources);
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

  }

  private async runTitleGeneration(chat: Chat, question: string): Promise<void> {
    try {
      const title = await generateChatTitle({
        provider: this.args.provider,
        model: this.currentModel,
        question,
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
    this.transcript.renderChat(chat);
    this.enterChatMode();
    this.inputEl.value = "";
    this.updateClearVisibility();
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
        const n = this.currentSourceCount;
        const srcLabel = n === 1 ? "1 source" : `${n} sources`;
        return `done in ${secs}s \u00B7 ${srcLabel}`;
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

  private renderFooterHints(): void {
    this.footerEl.empty();
    this.footerEl.removeClass("is-hidden");
    this.appendInstruction(this.footerEl, "↑↓", "to navigate");
    this.appendInstruction(this.footerEl, "↩", "to use");
    this.appendInstruction(this.footerEl, "esc", "to dismiss");
  }

  private renderFooterIndexingWarning(): void {
    // Only show in picker mode — in chat mode the footer is hidden entirely.
    if (this.contentEl.getAttr("data-mode") === "chat") return;
    this.footerEl.empty();
    this.footerEl.removeClass("is-hidden");
    const warn = this.footerEl.createDiv({ cls: "llm-wiki-query-footer-warning" });
    warn.textContent = "Indexing in progress \u2014 results may be less accurate";
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
    this.closeModelPopover();
    this.closeFolderPopover();
    this.controller?.cancel();

    // If a turn was in flight (user submitted a query and closed before it
    // finished), save whatever we have so the chat isn't left empty/untitled.
    this.saveInflightTurn();

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

  /**
   * If a turn was submitted but never finalized (e.g. the user pressed Esc
   * mid-stream), persist the partial turn and kick off title generation so
   * the chat doesn't stay empty and untitled in the history list.
   */
  private saveInflightTurn(): void {
    if (!this.lastSubmittedQuestion) return;
    const chat = this.activeChatId
      ? this.chats.find((c) => c.id === this.activeChatId)
      : null;
    if (!chat) return;

    // If the turn was already finalized, the question will be in the chat.
    const alreadySaved = chat.turns.some(
      (t) => t.question === this.lastSubmittedQuestion,
    );
    if (alreadySaved) return;

    const turn: ChatTurn = {
      question: this.lastSubmittedQuestion,
      answer: this.currentStreamedAnswer,
      sourceIds: this.currentScoredSources.map((s) => s.id),
      rewrittenQuery:
        this.currentRewrittenQuery !== this.lastSubmittedQuestion
          ? this.currentRewrittenQuery
          : null,
      createdAt: Date.now(),
    };

    const updatedChat = appendTurn(chat, turn, Date.now());
    this.chats = this.chats.map((c) =>
      c.id === updatedChat.id ? updatedChat : c,
    );
    this.args.onChatsChanged(this.chats);
    // Title generation was already fired at submit time — no need to
    // re-trigger it here.
  }
}
