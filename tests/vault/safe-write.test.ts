import { describe, it, expect } from "vitest";
import {
  isAllowedPath,
  PathNotAllowedError,
  getPluginDir,
  safeWritePluginData,
  safeReadPluginData,
} from "../../src/vault/safe-write.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("isAllowedPath", () => {
  const { app } = createMockApp();

  it("allows wiki/knowledge.json", () => {
    expect(isAllowedPath(app, "wiki/knowledge.json")).toBe(true);
  });

  it("allows files under wiki/entities/", () => {
    expect(isAllowedPath(app, "wiki/entities/alan-watts.md")).toBe(true);
  });

  it("allows files under wiki/concepts/", () => {
    expect(isAllowedPath(app, "wiki/concepts/zen-buddhism.md")).toBe(true);
  });

  it("allows files under wiki/sources/ at any depth", () => {
    expect(isAllowedPath(app, "wiki/sources/books/watts.md")).toBe(true);
  });

  it("allows files under the plugin's data dir (configDir-based)", () => {
    expect(
      isAllowedPath(app, `${getPluginDir(app)}/embeddings-cache.json`),
    ).toBe(true);
  });

  it("respects a non-default configDir", () => {
    const custom = createMockApp().app;
    custom.vault.configDir = ".config/obsidian";
    expect(
      isAllowedPath(custom, ".config/obsidian/plugins/llm-wiki/chats.json"),
    ).toBe(true);
    expect(
      isAllowedPath(custom, ".obsidian/plugins/llm-wiki/chats.json"),
    ).toBe(false);
  });

  it("rejects user-authored notes", () => {
    expect(isAllowedPath(app, "Books/Watts.md")).toBe(false);
    expect(isAllowedPath(app, "Dailies/12 March 2026.md")).toBe(false);
    expect(isAllowedPath(app, "notes/random.md")).toBe(false);
  });

  it("rejects path traversal escapes", () => {
    expect(isAllowedPath(app, "wiki/../Books/Watts.md")).toBe(false);
    expect(isAllowedPath(app, "wiki/entities/../../Books/Watts.md")).toBe(false);
    expect(isAllowedPath(app, "../wiki/knowledge.json")).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(isAllowedPath(app, "/etc/passwd")).toBe(false);
    expect(isAllowedPath(app, "/Users/x/wiki/knowledge.json")).toBe(false);
  });

  it("rejects empty and root paths", () => {
    expect(isAllowedPath(app, "")).toBe(false);
    expect(isAllowedPath(app, "/")).toBe(false);
  });

  it("rejects look-alike directories", () => {
    expect(isAllowedPath(app, "wiki-evil/knowledge.json")).toBe(false);
    expect(isAllowedPath(app, "wiki/entities-evil/x.md")).toBe(false);
  });
});

describe("PathNotAllowedError", () => {
  it("is throwable and exposes the bad path", () => {
    const err = new PathNotAllowedError("Books/sneaky.md");
    expect(err).toBeInstanceOf(Error);
    expect(err.path).toBe("Books/sneaky.md");
    expect(err.message).toContain("Books/sneaky.md");
  });
});

describe("safeWritePluginData", () => {
  it("writes a file under the plugin's data dir", async () => {
    const { app, files } = createMockApp();
    await safeWritePluginData(app, "embeddings-cache.json", "{}");
    const stored = files.get(
      `${getPluginDir(app)}/embeddings-cache.json`,
    );
    expect(stored?.content).toBe("{}");
  });

  it("rejects an attempt to escape the plugin folder", async () => {
    const { app } = createMockApp();
    await expect(
      safeWritePluginData(app, "../../../etc/passwd", "x"),
    ).rejects.toThrow(PathNotAllowedError);
  });

  it("rejects an absolute filename", async () => {
    const { app } = createMockApp();
    await expect(
      safeWritePluginData(app, "/tmp/x", "x"),
    ).rejects.toThrow(PathNotAllowedError);
  });
});

describe("safeReadPluginData", () => {
  it("reads a file under the plugin's data dir", async () => {
    const { app } = createMockApp();
    await safeWritePluginData(app, "test.json", '{"a":1}');
    const result = await safeReadPluginData(app, "test.json");
    expect(result).toBe('{"a":1}');
  });

  it("returns null when the file does not exist", async () => {
    const { app } = createMockApp();
    const result = await safeReadPluginData(app, "nope.json");
    expect(result).toBeNull();
  });
});
