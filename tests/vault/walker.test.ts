import { describe, it, expect } from "vitest";
import { walkVaultFiles, type WalkOptions } from "../../src/vault/walker.js";
import { createMockApp, type FakeFile } from "../helpers/mock-app.js";

const filesFor = (paths: string[]): FakeFile[] =>
  paths.map((p) => ({
    path: p,
    content: "x".repeat(100),
    mtime: 1700000000,
    ctime: 1700000000,
  }));

describe("walkVaultFiles", () => {
  const opts: WalkOptions = {
    skipDirs: ["wiki", ".obsidian", "Template", "Assets", ".trash"],
    minFileSize: 50,
    dailiesFromIso: "2026-04-05",
  };

  it("returns all qualifying markdown files", async () => {
    const { app } = createMockApp(
      filesFor(["Books/Watts.md", "Learn/Zen.md", "notes/random.md"]),
    );
    const result = await walkVaultFiles(app as never, opts);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.path)).toContain("Books/Watts.md");
  });

  it("skips files in skipDirs", async () => {
    const { app } = createMockApp(
      filesFor([
        "Books/Watts.md",
        "wiki/entities/alan-watts.md",
        ".obsidian/plugins/x/main.js.md",
        "Template/note.md",
      ]),
    );
    const result = await walkVaultFiles(app as never, opts);
    expect(result.map((r) => r.path)).toEqual(["Books/Watts.md"]);
  });

  it("skips files smaller than minFileSize", async () => {
    const { app } = createMockApp([
      {
        path: "tiny.md",
        content: "x",
        mtime: 1700000000,
        ctime: 1700000000,
      },
      {
        path: "Books/Watts.md",
        content: "x".repeat(100),
        mtime: 1700000000,
        ctime: 1700000000,
      },
    ]);
    const result = await walkVaultFiles(app as never, opts);
    expect(result.map((r) => r.path)).toEqual(["Books/Watts.md"]);
  });

  it("includes Dailies only when the date is >= dailiesFromIso", async () => {
    const { app } = createMockApp(
      filesFor([
        "Dailies/04 April 2026.md", // before cutoff
        "Dailies/05 April 2026.md", // exactly at cutoff
        "Dailies/06 April 2026.md", // after cutoff
        "Dailies/random.md", // unparseable
      ]),
    );
    const result = await walkVaultFiles(app as never, opts);
    const paths = result.map((r) => r.path);
    expect(paths).not.toContain("Dailies/04 April 2026.md");
    expect(paths).toContain("Dailies/05 April 2026.md");
    expect(paths).toContain("Dailies/06 April 2026.md");
    expect(paths).not.toContain("Dailies/random.md");
  });

  it("derives origin from path", async () => {
    const { app } = createMockApp(
      filesFor([
        "Clippings/article.md",
        "Dailies/06 April 2026.md",
        "Books/Watts.md",
      ]),
    );
    const result = await walkVaultFiles(app as never, opts);
    const byPath = new Map(result.map((r) => [r.path, r.origin]));
    expect(byPath.get("Clippings/article.md")).toBe("clipping");
    expect(byPath.get("Dailies/06 April 2026.md")).toBe("daily");
    expect(byPath.get("Books/Watts.md")).toBe("user-note");
  });
});
