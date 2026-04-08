/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { ChatList } from "../../../src/ui/modal/chat-list.js";
import { createChat } from "../../../src/chat/store.js";
import type { Chat } from "../../../src/chat/types.js";

function mk(id: string, title: string, updatedAt: number): Chat {
  return {
    ...createChat({ id, now: 0, folder: "", model: "m" }),
    title,
    updatedAt,
  };
}

describe("ChatList", () => {
  it("renders one row per chat, newest first", () => {
    const root = document.createElement("div");
    const list = new ChatList(root, {
      onPick: () => {},
      onRename: () => {},
      onDelete: () => {},
    });
    list.render([mk("a", "A", 1), mk("b", "B", 5)], null);
    const titles = [...root.querySelectorAll(".chat-title")].map(
      (e) => e.textContent,
    );
    expect(titles).toEqual(["B", "A"]);
  });

  it("fires onPick when a row is clicked", () => {
    const root = document.createElement("div");
    const onPick = vi.fn();
    const list = new ChatList(root, {
      onPick,
      onRename: () => {},
      onDelete: () => {},
    });
    list.render([mk("a", "A", 1)], null);
    (root.querySelector(".chat-row") as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith("a");
  });

  it("fires onDelete when the delete button is clicked, not onPick", () => {
    const root = document.createElement("div");
    const onPick = vi.fn();
    const onDelete = vi.fn();
    const list = new ChatList(root, {
      onPick,
      onRename: () => {},
      onDelete,
    });
    list.render([mk("a", "A", 1)], null);
    (root.querySelector(".chat-row .delete") as HTMLElement).click();
    expect(onDelete).toHaveBeenCalledWith("a");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("rename flow: click → input → Enter commits via onRename", () => {
    const root = document.createElement("div");
    const onRename = vi.fn();
    const onPick = vi.fn();
    const list = new ChatList(root, {
      onPick,
      onRename,
      onDelete: () => {},
    });
    list.render([mk("a", "A", 1)], null);
    (root.querySelector(".chat-row .rename") as HTMLElement).click();
    const input = root.querySelector(".chat-row input") as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "New title";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onRename).toHaveBeenCalledWith("a", "New title");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("rename flow: Escape reverts without onRename", () => {
    const root = document.createElement("div");
    const onRename = vi.fn();
    const list = new ChatList(root, {
      onPick: () => {},
      onRename,
      onDelete: () => {},
    });
    list.render([mk("a", "A", 1)], null);
    (root.querySelector(".chat-row .rename") as HTMLElement).click();
    const input = root.querySelector(".chat-row input") as HTMLInputElement;
    input.value = "Whatever";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(root.querySelector(".chat-title")?.textContent).toBe("A");
  });

  it("moveSelection steps through rows in order", () => {
    const root = document.createElement("div");
    const list = new ChatList(root, {
      onPick: () => {},
      onRename: () => {},
      onDelete: () => {},
    });
    list.render([mk("a", "A", 2), mk("b", "B", 1)], null);
    list.moveSelection(1);
    expect(list.getSelectedId()).toBe("a");
    list.moveSelection(1);
    expect(list.getSelectedId()).toBe("b");
  });

  it("render with selectedId marks that row .is-selected", () => {
    const root = document.createElement("div");
    const list = new ChatList(root, {
      onPick: () => {},
      onRename: () => {},
      onDelete: () => {},
    });
    list.render([mk("a", "A", 2), mk("b", "B", 1)], "b");
    const rows = [...root.querySelectorAll(".chat-row")];
    expect(rows[0]?.classList.contains("is-selected")).toBe(false);
    expect(rows[1]?.classList.contains("is-selected")).toBe(true);
  });
});
