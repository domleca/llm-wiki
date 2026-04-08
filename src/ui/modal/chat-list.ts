/**
 * Renders the list of past chats inside a host element. Click a row to resume;
 * hover reveals rename + delete buttons. Sorting is delegated to
 * `sortChatsByRecency`. Markdown-free — purely textual rows.
 */
import type { Chat } from "../../chat/types.js";
import { sortChatsByRecency } from "../../chat/store.js";

export interface ChatListCallbacks {
  onPick(chatId: string): void;
  onRename(chatId: string, newTitle: string): void;
  onDelete(chatId: string): void;
}

export class ChatList {
  private chats: Chat[] = [];
  private selectedIdx = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: ChatListCallbacks,
  ) {}

  render(chats: readonly Chat[], selectedId: string | null): void {
    this.chats = sortChatsByRecency(chats);
    this.selectedIdx = selectedId
      ? this.chats.findIndex((c) => c.id === selectedId)
      : -1;
    this.root.innerHTML = "";
    this.chats.forEach((c, i) => this.root.appendChild(this.buildRow(c, i)));
  }

  getSelectedId(): string | null {
    return this.selectedIdx >= 0 ? (this.chats[this.selectedIdx]?.id ?? null) : null;
  }

  moveSelection(delta: number): void {
    if (this.chats.length === 0) return;
    const next =
      this.selectedIdx === -1
        ? delta > 0
          ? 0
          : this.chats.length - 1
        : this.selectedIdx + delta;
    if (next < 0 || next >= this.chats.length) return;
    this.selectedIdx = next;
    this.refreshHighlight();
  }

  private buildRow(chat: Chat, idx: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "chat-row";
    if (idx === this.selectedIdx) row.classList.add("is-selected");
    row.dataset.id = chat.id;

    const title = document.createElement("span");
    title.className = "chat-title";
    title.textContent = chat.title;
    row.appendChild(title);

    const rename = document.createElement("button");
    rename.className = "rename";
    rename.type = "button";
    rename.setAttribute("aria-label", "Rename chat");
    rename.textContent = "✎";
    row.appendChild(rename);

    const del = document.createElement("button");
    del.className = "delete";
    del.type = "button";
    del.setAttribute("aria-label", "Delete chat");
    del.textContent = "×";
    row.appendChild(del);

    row.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      if (
        target.closest(".rename") ||
        target.closest(".delete") ||
        target.tagName === "INPUT"
      ) {
        return;
      }
      this.cb.onPick(chat.id);
    });

    rename.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.startRename(row, chat);
    });

    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.cb.onDelete(chat.id);
    });

    return row;
  }

  private startRename(row: HTMLElement, chat: Chat): void {
    const titleEl = row.querySelector(".chat-title") as HTMLElement;
    const input = document.createElement("input");
    input.type = "text";
    input.value = chat.title;
    row.replaceChild(input, titleEl);
    input.focus();
    input.select();

    let committed = false;
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const v = input.value.trim();
      if (v.length > 0 && v !== chat.title) this.cb.onRename(chat.id, v);
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        committed = true;
        if (input.parentNode === row) row.replaceChild(titleEl, input);
      }
    });
    input.addEventListener("blur", commit);
  }

  private refreshHighlight(): void {
    [...this.root.querySelectorAll(".chat-row")].forEach((el, i) =>
      el.classList.toggle("is-selected", i === this.selectedIdx),
    );
  }
}
