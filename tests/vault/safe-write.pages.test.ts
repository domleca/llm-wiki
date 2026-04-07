import { describe, it, expect } from "vitest";
import { createMockApp } from "../helpers/mock-app.js";
import {
  safeWritePage,
  safeDeletePage,
  listPagePaths,
  PathNotAllowedError,
} from "../../src/vault/safe-write.js";

describe("safeWritePage", () => {
  it("writes a file under wiki/entities/", async () => {
    const { app, files } = createMockApp();
    await safeWritePage(app as never, "wiki/entities/alan-watts.md", "content");
    expect(files.get("wiki/entities/alan-watts.md")?.content).toBe("content");
  });

  it("writes a file under wiki/concepts/", async () => {
    const { app, files } = createMockApp();
    await safeWritePage(app as never, "wiki/concepts/zen.md", "content");
    expect(files.get("wiki/concepts/zen.md")?.content).toBe("content");
  });

  it("writes a nested source page under wiki/sources/", async () => {
    const { app, files } = createMockApp();
    await safeWritePage(app as never, "wiki/sources/Books/Watts.md", "src");
    expect(files.get("wiki/sources/Books/Watts.md")?.content).toBe("src");
  });

  it("throws PathNotAllowedError for paths outside allowlist", async () => {
    const { app } = createMockApp();
    await expect(
      safeWritePage(app as never, "notes/evil.md", "bad"),
    ).rejects.toBeInstanceOf(PathNotAllowedError);
  });

  it("overwrites an existing page", async () => {
    const { app, files } = createMockApp();
    await safeWritePage(app as never, "wiki/entities/foo.md", "v1");
    await safeWritePage(app as never, "wiki/entities/foo.md", "v2");
    expect(files.get("wiki/entities/foo.md")?.content).toBe("v2");
  });
});

describe("safeDeletePage", () => {
  it("deletes an existing page", async () => {
    const { app, files } = createMockApp();
    await safeWritePage(app as never, "wiki/entities/alan-watts.md", "x");
    await safeDeletePage(app as never, "wiki/entities/alan-watts.md");
    expect(files.has("wiki/entities/alan-watts.md")).toBe(false);
  });

  it("is a no-op when file does not exist", async () => {
    const { app } = createMockApp();
    await expect(
      safeDeletePage(app as never, "wiki/entities/ghost.md"),
    ).resolves.toBeUndefined();
  });

  it("throws PathNotAllowedError for paths outside allowlist", async () => {
    const { app } = createMockApp();
    await expect(
      safeDeletePage(app as never, "notes/evil.md"),
    ).rejects.toBeInstanceOf(PathNotAllowedError);
  });
});

describe("listPagePaths", () => {
  it("returns all .md files under the given prefix", async () => {
    const { app } = createMockApp();
    await safeWritePage(app as never, "wiki/entities/alan-watts.md", "a");
    await safeWritePage(app as never, "wiki/entities/karpathy.md", "b");
    const paths = await listPagePaths(app as never, "wiki/entities/");
    expect(paths.sort()).toEqual([
      "wiki/entities/alan-watts.md",
      "wiki/entities/karpathy.md",
    ]);
  });

  it("returns nested paths under wiki/sources/", async () => {
    const { app } = createMockApp();
    await safeWritePage(app as never, "wiki/sources/Books/Watts.md", "w");
    await safeWritePage(app as never, "wiki/sources/Learn/Zen.md", "z");
    const paths = await listPagePaths(app as never, "wiki/sources/");
    expect(paths.sort()).toEqual([
      "wiki/sources/Books/Watts.md",
      "wiki/sources/Learn/Zen.md",
    ]);
  });

  it("returns empty array when directory has no files", async () => {
    const { app } = createMockApp();
    const paths = await listPagePaths(app as never, "wiki/entities/");
    expect(paths).toEqual([]);
  });

  it("throws PathNotAllowedError for disallowed prefix", async () => {
    const { app } = createMockApp();
    await expect(
      listPagePaths(app as never, "notes/"),
    ).rejects.toBeInstanceOf(PathNotAllowedError);
  });
});
