import { describe, it, expect } from "vitest";
import {
  isAllowedPath,
  PathNotAllowedError,
  ALLOWED_PREFIXES,
} from "../../src/vault/safe-write.js";

describe("isAllowedPath", () => {
  it("allows wiki/knowledge.json", () => {
    expect(isAllowedPath("wiki/knowledge.json")).toBe(true);
  });

  it("allows files under wiki/entities/", () => {
    expect(isAllowedPath("wiki/entities/alan-watts.md")).toBe(true);
  });

  it("allows files under wiki/concepts/", () => {
    expect(isAllowedPath("wiki/concepts/zen-buddhism.md")).toBe(true);
  });

  it("allows files under wiki/sources/ at any depth", () => {
    expect(isAllowedPath("wiki/sources/books/watts.md")).toBe(true);
  });

  it("allows files under .obsidian/plugins/llm-wiki/", () => {
    expect(
      isAllowedPath(".obsidian/plugins/llm-wiki/embeddings-cache.json"),
    ).toBe(true);
  });

  it("rejects user-authored notes", () => {
    expect(isAllowedPath("Books/Watts.md")).toBe(false);
    expect(isAllowedPath("Dailies/12 March 2026.md")).toBe(false);
    expect(isAllowedPath("notes/random.md")).toBe(false);
  });

  it("rejects path traversal escapes", () => {
    expect(isAllowedPath("wiki/../Books/Watts.md")).toBe(false);
    expect(isAllowedPath("wiki/entities/../../Books/Watts.md")).toBe(false);
    expect(isAllowedPath("../wiki/knowledge.json")).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(isAllowedPath("/etc/passwd")).toBe(false);
    expect(isAllowedPath("/Users/x/wiki/knowledge.json")).toBe(false);
  });

  it("rejects empty and root paths", () => {
    expect(isAllowedPath("")).toBe(false);
    expect(isAllowedPath("/")).toBe(false);
  });

  it("rejects look-alike directories", () => {
    expect(isAllowedPath("wiki-evil/knowledge.json")).toBe(false);
    expect(isAllowedPath("wiki/entities-evil/x.md")).toBe(false);
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

describe("ALLOWED_PREFIXES is exported and frozen", () => {
  it("contains the documented prefixes", () => {
    expect(ALLOWED_PREFIXES).toContain("wiki/knowledge.json");
    expect(ALLOWED_PREFIXES).toContain("wiki/entities/");
    expect(ALLOWED_PREFIXES).toContain("wiki/concepts/");
    expect(ALLOWED_PREFIXES).toContain("wiki/sources/");
    expect(ALLOWED_PREFIXES).toContain("wiki/index.md");
    expect(ALLOWED_PREFIXES).toContain("wiki/log.md");
    expect(ALLOWED_PREFIXES).toContain("wiki/memory.md");
    expect(ALLOWED_PREFIXES).toContain(".obsidian/plugins/llm-wiki/");
  });
});
