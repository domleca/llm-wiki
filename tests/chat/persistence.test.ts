import { describe, it, expect } from "vitest";
import { loadChats, saveChats } from "../../src/chat/persistence.js";
import { createChat } from "../../src/chat/store.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("chat persistence", () => {
  it("round-trips via save/load", async () => {
    const { app } = createMockApp();
    const chats = [createChat({ id: "a", now: 1, folder: "", model: "m" })];
    await saveChats(app as never, chats);
    expect(await loadChats(app as never)).toEqual(chats);
  });

  it("returns empty array when file missing", async () => {
    const { app } = createMockApp();
    expect(await loadChats(app as never)).toEqual([]);
  });

  it("returns empty array on malformed JSON", async () => {
    const { app } = createMockApp();
    await saveChats(app as never, []);
    const { safeWritePluginData } = await import("../../src/vault/safe-write.js");
    await safeWritePluginData(app as never, "chats.json", "{not json");
    expect(await loadChats(app as never)).toEqual([]);
  });

  it("returns empty array when JSON is a non-array value", async () => {
    const { app } = createMockApp();
    const { safeWritePluginData } = await import("../../src/vault/safe-write.js");
    await safeWritePluginData(app as never, "chats.json", JSON.stringify({ not: "an array" }));
    expect(await loadChats(app as never)).toEqual([]);
  });
});
