/**
 * Renders a multi-turn chat transcript inside a host element. User turns are
 * shown as right-offset bubbles; assistant answers render as plain markdown
 * underneath. A "Thinking…" indicator occupies the assistant slot until the
 * first stream chunk lands.
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

export class ChatTranscript {
  /** When true, new content scrolls the viewport; flipped off when the user scrolls up. */
  private followStream = true;

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
    this.followStream = true;
  }

  renderChat(chat: Chat): void {
    this.clear();
    for (const t of chat.turns) {
      const { answerEl, sourcesEl } = this.appendTurnBlock(t.question, {
        withThinking: false,
      });
      this.opts.renderMarkdown(answerEl, t.answer);
      this.fillSources(sourcesEl, t.sourceIds);
    }
    this.followStream = true;
    this.scrollToBottomIfFollowing(true);
  }

  beginTurn(question: string): TurnHandle {
    const { answerEl, sourcesEl, thinkingEl } = this.appendTurnBlock(question, {
      withThinking: true,
    });
    // New turn counts as user intent to follow the latest content.
    this.followStream = true;
    this.scrollToBottomIfFollowing(true);

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
        if (thinkingEl && thinkingEl.parentNode) {
          thinkingEl.remove();
        }
        buffer += text;
        // Debounce markdown re-renders so tokens accumulate between frames.
        // This makes it far less likely that a bold/italic marker opens in one
        // render and closes in the next, which is what causes the visible pop.
        renderDirty = true;
        if (!renderTimer) {
          renderTimer = setTimeout(flushRender, 80);
        }
      },
      setSources: (ids: readonly string[]): void =>
        this.fillSources(sourcesEl, ids),
      finalize: (): void => {
        if (thinkingEl && thinkingEl.parentNode) {
          thinkingEl.remove();
        }
        // Flush any pending render immediately so the final state is complete.
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
    sourcesEl: HTMLDetailsElement;
    thinkingEl: HTMLDivElement | null;
  } {
    const turn = document.createElement("div");
    turn.className = "turn";

    const q = document.createElement("div");
    q.className = "turn-q";
    q.textContent = question;
    turn.appendChild(q);

    let thinkingEl: HTMLDivElement | null = null;
    if (opts.withThinking) {
      thinkingEl = document.createElement("div");
      thinkingEl.className = "turn-thinking";
      const label = document.createElement("span");
      label.className = "turn-thinking-label";
      label.textContent = "Thinking";
      const dots = document.createElement("span");
      dots.className = "turn-thinking-dots";
      dots.textContent = "...";
      thinkingEl.append(label, dots);
      turn.appendChild(thinkingEl);
    }

    const a = document.createElement("div");
    a.className = "turn-a";
    turn.appendChild(a);

    const s = document.createElement("details");
    s.className = "turn-sources";
    const summary = document.createElement("summary");
    summary.textContent = "Sources used (0)";
    s.appendChild(summary);
    turn.appendChild(s);

    this.root.appendChild(turn);
    return { answerEl: a, sourcesEl: s, thinkingEl };
  }

  private fillSources(
    details: HTMLDetailsElement,
    ids: readonly string[],
  ): void {
    const summary = details.querySelector("summary");
    if (summary) summary.textContent = `Sources used (${ids.length})`;
    details.querySelector("ul")?.remove();
    if (ids.length > 0) {
      const ul = document.createElement("ul");
      for (const id of ids) {
        const li = document.createElement("li");
        li.textContent = id;
        ul.appendChild(li);
      }
      details.appendChild(ul);
    }
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
