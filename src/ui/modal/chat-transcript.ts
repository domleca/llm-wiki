/**
 * Renders a multi-turn chat transcript inside a host element. Supports bulk
 * rendering of an existing chat and streaming a new turn's answer
 * chunk-by-chunk via `beginTurn`. Markdown rendering is injected so the real
 * modal can pass Obsidian's `MarkdownRenderer.render` while tests stub it.
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

export class ChatTranscript {
  constructor(
    private readonly root: HTMLElement,
    private readonly opts: ChatTranscriptOptions,
  ) {}

  clear(): void {
    this.root.innerHTML = "";
  }

  renderChat(chat: Chat): void {
    this.clear();
    for (const t of chat.turns) {
      const { answerEl, sourcesEl } = this.appendTurnBlock(t.question);
      this.opts.renderMarkdown(answerEl, t.answer);
      this.fillSources(sourcesEl, t.sourceIds);
    }
    this.scrollToBottom();
  }

  beginTurn(question: string): TurnHandle {
    const { answerEl, sourcesEl } = this.appendTurnBlock(question);
    let buffer = "";
    return {
      appendAnswerChunk: (text: string): void => {
        buffer += text;
        this.opts.renderMarkdown(answerEl, buffer);
        this.scrollToBottom();
      },
      setSources: (ids: readonly string[]): void =>
        this.fillSources(sourcesEl, ids),
      finalize: (): void => {
        this.scrollToBottom();
      },
    };
  }

  private appendTurnBlock(question: string): {
    answerEl: HTMLDivElement;
    sourcesEl: HTMLDetailsElement;
  } {
    const turn = document.createElement("div");
    turn.className = "turn";
    const q = document.createElement("div");
    q.className = "turn-q";
    q.textContent = question;
    const a = document.createElement("div");
    a.className = "turn-a";
    const s = document.createElement("details");
    s.className = "turn-sources";
    const summary = document.createElement("summary");
    summary.textContent = "Sources used (0)";
    s.appendChild(summary);
    turn.append(q, a, s);
    this.root.appendChild(turn);
    return { answerEl: a, sourcesEl: s };
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

  private scrollToBottom(): void {
    this.root.scrollTop = this.root.scrollHeight;
  }
}
