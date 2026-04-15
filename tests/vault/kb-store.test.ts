import { describe, it, expect } from "vitest";
import { KnowledgeBase } from "../../src/core/kb.js";
import { loadKB, saveKB, KBStaleError } from "../../src/vault/kb-store.js";
import { createMockApp } from "../helpers/mock-app.js";

const KB_PATH = "wiki/knowledge.json";

describe("loadKB", () => {
  it("returns an empty KB when no file exists", async () => {
    const { app } = createMockApp();
    const { kb, mtime } = await loadKB(app as never);
    expect(kb).toBeInstanceOf(KnowledgeBase);
    expect(kb.stats().entities).toBe(0);
    expect(mtime).toBe(0);
  });

  it("loads an existing KB and returns its mtime", async () => {
    const { app, files } = createMockApp();
    files.set(KB_PATH, {
      path: KB_PATH,
      content: JSON.stringify({
        meta: { version: 1, created: "2026-01-01", updated: "2026-04-01" },
        entities: {
          "alan-watts": {
            id: "alan-watts",
            name: "Alan Watts",
            type: "person",
            aliases: [],
            facts: ["fact"],
            sources: [],
          },
        },
        concepts: {},
        connections: [],
        sources: {},
      }),
      mtime: 1234567890,
      ctime: 1234567890,
    });
    const { kb, mtime } = await loadKB(app as never);
    expect(kb.stats().entities).toBe(1);
    expect(kb.data.entities["alan-watts"]?.name).toBe("Alan Watts");
    expect(mtime).toBe(1234567890);
  });

  it("falls back to an empty KB if the file disappears after exists()", async () => {
    const app = {
      vault: {
        adapter: {
          exists: async (path: string) => path === KB_PATH,
          read: async (_path: string) => {
            const err = new Error(
              `ENOENT: no such file or directory, open '${KB_PATH}'`,
            ) as Error & { code?: string };
            err.code = "ENOENT";
            throw err;
          },
          write: async () => {
            throw new Error("not used");
          },
          mkdir: async () => {
            throw new Error("not used");
          },
          stat: async () => null,
        },
      },
    };

    const { kb, mtime } = await loadKB(app as never);
    expect(kb).toBeInstanceOf(KnowledgeBase);
    expect(kb.stats().entities).toBe(0);
    expect(mtime).toBe(0);
  });
});

describe("saveKB", () => {
  it("writes the KB content to wiki/knowledge.json", async () => {
    const { app, files } = createMockApp();
    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Alan Watts", type: "person", facts: ["x"] });
    await saveKB(app as never, kb, 0);
    const stored = files.get(KB_PATH);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!.content);
    expect(parsed.entities["alan-watts"]?.name).toBe("Alan Watts");
  });

  it("creates the wiki directory before writing the KB", async () => {
    const dirs = new Set<string>();
    const writes: string[] = [];
    const app = {
      vault: {
        adapter: {
          exists: async (path: string) => path === KB_PATH ? false : dirs.has(path),
          read: async () => {
            throw new Error("not used");
          },
          write: async (path: string, content: string) => {
            if (!dirs.has("wiki")) {
              throw new Error(`ENOENT: no such file or directory, open '${path}'`);
            }
            writes.push(content);
          },
          mkdir: async (path: string) => {
            dirs.add(path);
          },
          stat: async () => null,
        },
      },
    };

    const kb = new KnowledgeBase();
    kb.addEntity({ name: "Alan Watts", type: "person", facts: ["x"] });
    await expect(saveKB(app as never, kb, 0)).resolves.not.toThrow();
    expect(dirs.has("wiki")).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("throws KBStaleError when the on-disk mtime is newer than expectedMtime", async () => {
    const { app, files } = createMockApp();
    files.set(KB_PATH, {
      path: KB_PATH,
      content: "{}",
      mtime: 2000,
      ctime: 0,
    });
    const kb = new KnowledgeBase();
    await expect(saveKB(app as never, kb, 1000)).rejects.toThrow(KBStaleError);
  });

  it("succeeds when expectedMtime matches the on-disk mtime", async () => {
    const { app, files } = createMockApp();
    files.set(KB_PATH, {
      path: KB_PATH,
      content: "{}",
      mtime: 2000,
      ctime: 0,
    });
    const kb = new KnowledgeBase();
    await expect(saveKB(app as never, kb, 2000)).resolves.not.toThrow();
  });
});
