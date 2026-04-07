import { describe, it, expect } from "vitest";
import { safeAppendPluginData } from "../../src/vault/safe-write.js";
import { createMockApp } from "../helpers/mock-app.js";

describe("safeAppendPluginData", () => {
  it("creates the file and writes the first line", async () => {
    const { app, files } = createMockApp();
    await safeAppendPluginData(
      app as never,
      "interactions/2026-04-09.jsonl",
      '{"a":1}',
    );
    const path = ".obsidian/plugins/llm-wiki/interactions/2026-04-09.jsonl";
    expect(files.get(path)?.content).toBe('{"a":1}\n');
  });

  it("appends to an existing file", async () => {
    const { app, files } = createMockApp();
    const path = ".obsidian/plugins/llm-wiki/interactions/x.jsonl";
    // Seed an existing file through the adapter so the mock records it properly.
    await app.vault.adapter.write(path, "first\n");
    await safeAppendPluginData(app as never, "interactions/x.jsonl", "second");
    expect(files.get(path)?.content).toBe("first\nsecond\n");
  });

  it("does not double newline when line already ends with \\n", async () => {
    const { app, files } = createMockApp();
    await safeAppendPluginData(
      app as never,
      "interactions/y.jsonl",
      "already\n",
    );
    const path = ".obsidian/plugins/llm-wiki/interactions/y.jsonl";
    expect(files.get(path)?.content).toBe("already\n");
  });

  it("rejects paths that escape the plugin dir", async () => {
    const { app } = createMockApp();
    await expect(
      safeAppendPluginData(app as never, "../../etc/passwd", "x"),
    ).rejects.toThrow();
  });

  it("rejects absolute paths", async () => {
    const { app } = createMockApp();
    await expect(
      safeAppendPluginData(app as never, "/tmp/x.jsonl", "x"),
    ).rejects.toThrow();
  });
});
