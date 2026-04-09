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

import { type App, TFile, setIcon } from "obsidian";
import type { Chat } from "../../chat/types.js";
import type { ScoredSource } from "./query-modal.js";

export interface ChatTranscriptOptions {
  app: App;
  renderMarkdown: (el: HTMLElement, md: string) => void;
}

export interface TurnHandle {
  setThinkingText(text: string): void;
  appendAnswerChunk(text: string): void;
  setSources(sources: readonly ScoredSource[]): void;
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
  "Connecting the dots",
  "\u21AF Sparking neurons",
  "\u223F Tuning in",
  "\u2318 Processing",
  "Obsidianizing",
  "Piecing it together",
  "Almost there, probably",
  "Dusting off old pages",
  "Flipping through the archives",
  "Checking the index cards",
  "Following the breadcrumbs",
  "Warming up the synapses",
  "Hold that thought",
  "Shh, concentrating",
  "Not lost, just exploring",
  "Browsing the margins",
  "Weaving the threads",
  "Hmm, interesting question",
  "Working on it, promise",
  "Give me a second",
  "This is a good one",
  "Crunching away",
  "Let me cook",
  "Brewing an answer",
  "Assembling the puzzle",
  "Running the numbers",
  "Trust the process",
  "Going down the rabbit hole",
  "Turning it over",
  "Looking at this from every angle",
  "Zooming in",
  "Hang on a sec",
  "Good question, actually",
  "Let me think about that",
  "Getting there",
  "Bear with me",
  "Almost got it",
  "Working our magic",
  "Just a moment",
  "Wheels are turning",
  "Percolating",
  "Marinating on this",
  "Chewing on that",
  "Noodling",
  "Loading brilliance",
  "Summoning answers",
  "Doing the thing",
];


/** Strip leading date prefix (e.g. "2025-12-23-") and replace hyphens with spaces. */
function cleanBasename(name: string): string {
  return name
    .replace(/^\d{4}-\d{2}-\d{2}-?/, "")
    .replace(/-/g, " ")
    .trim();
}

function randomThinkingMessage(): string {
  return THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)]!;
}

/** Clear all children from an element, using Obsidian's .empty() when available. */
function emptyEl(el: HTMLElement): void {
  if (typeof (el as { empty?: () => void }).empty === "function") {
    (el as { empty: () => void }).empty();
  } else {
    el.innerHTML = "";
  }
}

export class ChatTranscript {
  /** When true, new content scrolls the viewport; flipped off when the user scrolls up. */
  private followStream = true;

  /** Accumulated source scores across all turns, keyed by source ID. */
  private sourceScores = new Map<string, number>();
  /** Turn counter used for recency weighting. */
  private turnIndex = 0;

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
    emptyEl(this.root);
    this.sourceScores = new Map();
    this.turnIndex = 0;
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
      // Stored turns don't carry scores — assign decaying weight by position
      // so earliest sources in the saved order rank higher, with a small
      // recency boost per turn.
      const scored: ScoredSource[] = t.sourceIds.map((id, i) => ({
        id,
        score: 1 / (i + 1),
      }));
      this.addSources(scored);
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

    // Rotate the thinking message every 5s while waiting
    let thinkingRotation: ReturnType<typeof setInterval> | null = null;
    if (thinkingLabelEl) {
      thinkingRotation = setInterval(() => {
        thinkingLabelEl.textContent = randomThinkingMessage();
      }, 5_000);
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
      setThinkingText: (text: string): void => {
        if (thinkingLabelEl) {
          thinkingLabelEl.textContent = text;
        }
        // Lock: stop rotating away from a meaningful message
        if (thinkingRotation !== null) {
          clearInterval(thinkingRotation);
          thinkingRotation = null;
        }
      },
      appendAnswerChunk: (text: string): void => {
        stopThinking();
        buffer += text;
        renderDirty = true;
        if (!renderTimer) {
          renderTimer = setTimeout(flushRender, 80);
        }
      },
      setSources: (sources: readonly ScoredSource[]): void => {
        this.addSources(sources);
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

  /** Accumulate scored sources. Later turns get a small recency boost. */
  private addSources(sources: readonly ScoredSource[]): void {
    const recencyBoost = 1 + this.turnIndex * 0.15;
    for (const s of sources) {
      const prev = this.sourceScores.get(s.id) ?? 0;
      this.sourceScores.set(s.id, prev + s.score * recencyBoost);
    }
    this.turnIndex++;
  }

  /** Return source IDs sorted by accumulated score (best first). */
  private rankedSourceIds(): string[] {
    return [...this.sourceScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }

  /** Render (or re-render) the consolidated sources footer at the bottom. */
  private renderSourcesFooter(): void {
    const ranked = this.rankedSourceIds();
    if (ranked.length === 0) {
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
    emptyEl(footer);

    // Divider: left-aligned label + chevron, then line stretches right
    const divider = document.createElement("div");
    divider.className = "transcript-sources-divider";

    const chevron = document.createElement("span");
    chevron.className = "transcript-sources-chevron";
    setIcon(chevron, "chevron-right");
    divider.appendChild(chevron);

    const label = document.createElement("span");
    label.className = "transcript-sources-label";
    label.textContent = `Sources (${ranked.length})`;
    divider.appendChild(label);

    footer.appendChild(divider);

    const list = document.createElement("div");
    list.className = "transcript-sources-list";
    footer.appendChild(list);

    for (const id of ranked) {
      list.appendChild(this.buildSourcePill(id));
    }

    // Toggle expand/collapse on divider click
    divider.addEventListener("click", () => {
      footer.classList.toggle("is-expanded");
      this.scrollToBottomIfFollowing(false);
    });
  }

  private buildSourcePill(id: string): HTMLDivElement {
    const pill = document.createElement("div");
    pill.className = "transcript-source-pill";

    const title = document.createElement("span");
    title.className = "transcript-source-title";
    title.textContent = this.resolveTitle(id);
    pill.appendChild(title);

    pill.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.openInBackground(id);
    });
    return pill;
  }

  /** Resolve a file path to its display title (frontmatter title, H1, or cleaned basename). */
  private resolveTitle(path: string): string {
    const app = this.opts.app;
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return cleanBasename(path.replace(/\.md$/, "").split("/").pop() ?? path);
    }
    const cache = app.metadataCache.getFileCache(file);
    // Frontmatter title takes priority
    const fmTitle = cache?.frontmatter?.["title"];
    if (typeof fmTitle === "string" && fmTitle.trim()) return fmTitle.trim();
    // First H1 heading
    const h1 = cache?.headings?.find((h) => h.level === 1);
    if (h1) return h1.heading;
    // Cleaned basename
    return cleanBasename(file.basename);
  }

  /** Open a note in a new tab. */
  private openInBackground(path: string): void {
    const app = this.opts.app;
    // Strip .md for openLinkText — it resolves the note by link text,
    // not raw file path, so "folder/note" works even for iCloud-evicted files.
    const linkText = path.endsWith(".md") ? path.slice(0, -3) : path;
    void app.workspace.openLinkText(linkText, "", true);
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
