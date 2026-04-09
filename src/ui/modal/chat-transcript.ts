/**
 * Renders a multi-turn chat transcript inside a host element. User turns are
 * shown as right-offset bubbles; assistant answers render as plain markdown
 * underneath. A "Thinking…" indicator occupies the assistant slot until the
 * first stream chunk lands.
 *
 * Sources are aggregated across all turns and displayed once at the bottom
 * of the transcript (top 10 by default, expandable).
 *
 * Scroll behavior: the transcript auto-follows the stream as long as the user
 * stays pinned near the bottom. The moment they scroll up, auto-follow is
 * released; it re-engages as soon as they scroll back to the bottom. Markdown
 * rendering is injected so tests can stub Obsidian's renderer.
 */

import type { Chat } from "../../chat/types.js";

export interface ChatTranscriptOptions {
  renderMarkdown: (el: HTMLElement, md: string) => void;
}

export interface TurnHandle {
  appendAnswerChunk(text: string): void;
  setSources(sourceIds: readonly string[]): void;
  finalize(): void;
}

/** Distance from the bottom (px) within which we still consider the user "at bottom". */
const FOLLOW_THRESHOLD_PX = 24;

const THINKING_MESSAGES = [
  "Thinking",
  "Digging through your notes",
  "Sifting through your thoughts",
  "Pulling threads together",
  "Leafing through your notes",
  "Reading your mind",
  "On it",
];

const VISIBLE_SOURCES = 10;

function randomThinkingMessage(): string {
  return THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)]!;
}

export class ChatTranscript {
  /** When true, new content scrolls the viewport; flipped off when the user scrolls up. */
  private followStream = true;

  /** Deduplicated source IDs accumulated across all turns, insertion-ordered. */
  private allSourceIds: string[] = [];

  /** The persistent sources footer element (lives at the end of root). */
  private sourcesFooter: HTMLDivElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: ChatTranscriptOptions,
  ) {
    this.root.addEventListener("scroll", () => {
      this.followStream = this.isAtBottom();
    });
  }

  clear(): void {
    this.root.innerHTML = "";
    this.allSourceIds = [];
    this.sourcesFooter = null;
    this.followStream = true;
  }

  renderChat(chat: Chat): void {
    this.clear();
    for (const t of chat.turns) {
      const { answerEl } = this.appendTurnBlock(t.question, {
        withThinking: false,
      });
      this.opts.renderMarkdown(answerEl, t.answer);
      this.addSources(t.sourceIds);
    }
    this.renderSourcesFooter();
    this.followStream = true;
    this.scrollToBottomIfFollowing(true);
  }

  beginTurn(question: string): TurnHandle {
    const { answerEl, thinkingEl, thinkingLabelEl } =
      this.appendTurnBlock(question, { withThinking: true });
    // New turn counts as user intent to follow the latest content.
    this.followStream = true;
    this.scrollToBottomIfFollowing(true);

    // Rotate the thinking message every 10s while waiting
    let thinkingRotation: ReturnType<typeof setInterval> | null = null;
    if (thinkingLabelEl) {
      thinkingRotation = setInterval(() => {
        thinkingLabelEl.textContent = randomThinkingMessage();
      }, 10_000);
    }

    const stopThinking = (): void => {
      if (thinkingEl && thinkingEl.parentNode) {
        thinkingEl.remove();
      }
      if (thinkingRotation !== null) {
        clearInterval(thinkingRotation);
        thinkingRotation = null;
      }
    };

    let buffer = "";
    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    let renderDirty = false;

    const flushRender = (): void => {
      renderTimer = null;
      renderDirty = false;
      this.opts.renderMarkdown(answerEl, buffer);
      this.scrollToBottomIfFollowing(false);
    };

    return {
      appendAnswerChunk: (text: string): void => {
        stopThinking();
        buffer += text;
        renderDirty = true;
        if (!renderTimer) {
          renderTimer = setTimeout(flushRender, 80);
        }
      },
      setSources: (ids: readonly string[]): void => {
        this.addSources(ids);
        this.renderSourcesFooter();
      },
      finalize: (): void => {
        stopThinking();
        if (renderTimer) {
          clearTimeout(renderTimer);
          renderTimer = null;
        }
        if (renderDirty) {
          this.opts.renderMarkdown(answerEl, buffer);
        }
        this.scrollToBottomIfFollowing(false);
      },
    };
  }

  private appendTurnBlock(
    question: string,
    opts: { withThinking: boolean },
  ): {
    answerEl: HTMLDivElement;
    thinkingEl: HTMLDivElement | null;
    thinkingLabelEl: HTMLSpanElement | null;
  } {
    const turn = document.createElement("div");
    turn.className = "turn";

    const q = document.createElement("div");
    q.className = "turn-q";
    q.textContent = question;
    turn.appendChild(q);

    let thinkingEl: HTMLDivElement | null = null;
    let thinkingLabelEl: HTMLSpanElement | null = null;
    if (opts.withThinking) {
      thinkingEl = document.createElement("div");
      thinkingEl.className = "turn-thinking";
      thinkingLabelEl = document.createElement("span");
      thinkingLabelEl.className = "turn-thinking-label";
      thinkingLabelEl.textContent = randomThinkingMessage();
      const dots = document.createElement("span");
      dots.className = "turn-thinking-dots";
      dots.textContent = "...";
      thinkingEl.append(thinkingLabelEl, dots);
      turn.appendChild(thinkingEl);
    }

    const a = document.createElement("div");
    a.className = "turn-a";
    turn.appendChild(a);

    // Insert before the sources footer so it always stays at the bottom
    if (this.sourcesFooter) {
      this.root.insertBefore(turn, this.sourcesFooter);
    } else {
      this.root.appendChild(turn);
    }
    return { answerEl: a, thinkingEl, thinkingLabelEl };
  }

  /** Add source IDs, deduplicating against what we already have. */
  private addSources(ids: readonly string[]): void {
    const existing = new Set(this.allSourceIds);
    for (const id of ids) {
      if (!existing.has(id)) {
        this.allSourceIds.push(id);
        existing.add(id);
      }
    }
  }

  /** Render (or re-render) the consolidated sources footer at the bottom. */
  private renderSourcesFooter(): void {
    if (this.allSourceIds.length === 0) {
      this.sourcesFooter?.remove();
      this.sourcesFooter = null;
      return;
    }

    if (!this.sourcesFooter) {
      this.sourcesFooter = document.createElement("div");
      this.sourcesFooter.className = "transcript-sources-footer";
      this.root.appendChild(this.sourcesFooter);
    }

    const footer = this.sourcesFooter;
    footer.innerHTML = "";

    const total = this.allSourceIds.length;
    const label = document.createElement("div");
    label.className = "transcript-sources-label";
    label.textContent = `Sources (${total})`;
    footer.appendChild(label);

    const list = document.createElement("div");
    list.className = "transcript-sources-list";
    footer.appendChild(list);

    const visible = this.allSourceIds.slice(0, VISIBLE_SOURCES);
    const overflow = this.allSourceIds.slice(VISIBLE_SOURCES);

    for (const id of visible) {
      list.appendChild(this.buildSourceRow(id));
    }

    if (overflow.length > 0) {
      const moreBtn = document.createElement("div");
      moreBtn.className = "transcript-sources-more";
      moreBtn.textContent = `Show ${overflow.length} more`;
      list.appendChild(moreBtn);

      moreBtn.addEventListener("click", () => {
        moreBtn.remove();
        for (const id of overflow) {
          list.appendChild(this.buildSourceRow(id));
        }
        this.scrollToBottomIfFollowing(false);
      });
    }
  }

  private buildSourceRow(id: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "transcript-source-item";
    row.textContent = id;
    return row;
  }

  private isAtBottom(): boolean {
    const distance =
      this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight;
    return distance <= FOLLOW_THRESHOLD_PX;
  }

  private scrollToBottomIfFollowing(force: boolean): void {
    if (force || this.followStream) {
      this.root.scrollTop = this.root.scrollHeight;
    }
  }
}
