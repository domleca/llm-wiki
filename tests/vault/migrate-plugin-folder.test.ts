import { describe, it, expect } from "vitest";
import { migratePluginFolder } from "../../src/vault/migrate-plugin-folder.js";
import { createMockApp } from "../helpers/mock-app.js";

const OLD = ".obsidian/plugins/llm-wiki-plugin";
const NEW = ".obsidian/plugins/lm-wiki";
const OLD_ID = "llm-wiki-plugin";
const NEW_ID = "lm-wiki";

async function seed(
  app: ReturnType<typeof createMockApp>["app"],
  path: string,
  content: string,
): Promise<void> {
  await app.vault.adapter.write(path, content);
}

describe("migratePluginFolder", () => {
  it("skips when the new folder already has data.json (already migrated)", async () => {
    const { app, writeLog } = createMockApp();
    await seed(app, `${NEW}/data.json`, '{"foo":1}');
    await seed(app, `${OLD}/data.json`, '{"old":true}');
    await seed(app, `${OLD}/chats.json`, "[]");

    const writesBefore = writeLog.length;
    const result = await migratePluginFolder(app, OLD_ID, NEW_ID);

    expect(result.skipped).toBe("already-migrated");
    expect(result.copied).toEqual([]);
    // No writes after the seed.
    expect(writeLog.length).toBe(writesBefore);
  });

  it("skips when there is no data in the old folder (fresh install)", async () => {
    const { app } = createMockApp();
    const result = await migratePluginFolder(app, OLD_ID, NEW_ID);
    expect(result.skipped).toBe("fresh-install");
    expect(result.copied).toEqual([]);
  });

  it("copies whitelisted user-data files", async () => {
    const { app, files } = createMockApp();
    await seed(app, `${OLD}/data.json`, '{"providerType":"ollama"}');
    await seed(app, `${OLD}/chats.json`, '[{"id":"c1"}]');
    await seed(app, `${OLD}/embeddings-cache.json`, '{"a":[0.1]}');
    await seed(app, `${OLD}/recent-questions.json`, '["q1"]');

    const result = await migratePluginFolder(app, OLD_ID, NEW_ID);

    expect(result.skipped).toBeNull();
    expect(result.copied).toEqual([
      "data.json",
      "chats.json",
      "embeddings-cache.json",
      "recent-questions.json",
    ]);
    expect(files.get(`${NEW}/data.json`)?.content).toBe(
      '{"providerType":"ollama"}',
    );
    expect(files.get(`${NEW}/chats.json`)?.content).toBe('[{"id":"c1"}]');
    expect(files.get(`${NEW}/embeddings-cache.json`)?.content).toBe(
      '{"a":[0.1]}',
    );
    expect(files.get(`${NEW}/recent-questions.json`)?.content).toBe('["q1"]');
  });

  it("copies interactions/ recursively", async () => {
    const { app, files } = createMockApp();
    await seed(app, `${OLD}/data.json`, "{}");
    await seed(app, `${OLD}/interactions/2026-04-09.jsonl`, '{"q":"a"}\n');
    await seed(app, `${OLD}/interactions/2026-04-10.jsonl`, '{"q":"b"}\n');

    const result = await migratePluginFolder(app, OLD_ID, NEW_ID);

    expect(result.skipped).toBeNull();
    expect(result.copied).toContain("interactions/ (2 files)");
    expect(files.get(`${NEW}/interactions/2026-04-09.jsonl`)?.content).toBe(
      '{"q":"a"}\n',
    );
    expect(files.get(`${NEW}/interactions/2026-04-10.jsonl`)?.content).toBe(
      '{"q":"b"}\n',
    );
  });

  it("does not copy non-whitelisted files (e.g. main.js, manifest.json)", async () => {
    const { app, files } = createMockApp();
    await seed(app, `${OLD}/data.json`, "{}");
    await seed(app, `${OLD}/main.js`, "console.log('old plugin')");
    await seed(app, `${OLD}/manifest.json`, '{"id":"llm-wiki-plugin"}');
    await seed(app, `${OLD}/styles.css`, "/* old */");
    await seed(app, `${OLD}/random-junk.txt`, "stuff");

    const result = await migratePluginFolder(app, OLD_ID, NEW_ID);

    expect(result.skipped).toBeNull();
    expect(result.copied).toEqual(["data.json"]);
    expect(files.has(`${NEW}/main.js`)).toBe(false);
    expect(files.has(`${NEW}/manifest.json`)).toBe(false);
    expect(files.has(`${NEW}/styles.css`)).toBe(false);
    expect(files.has(`${NEW}/random-junk.txt`)).toBe(false);
  });

  it("leaves the old folder intact (copy, not move)", async () => {
    const { app, files } = createMockApp();
    await seed(app, `${OLD}/data.json`, '{"x":1}');
    await seed(app, `${OLD}/chats.json`, "[]");
    await seed(app, `${OLD}/interactions/x.jsonl`, "y\n");

    await migratePluginFolder(app, OLD_ID, NEW_ID);

    expect(files.has(`${OLD}/data.json`)).toBe(true);
    expect(files.has(`${OLD}/chats.json`)).toBe(true);
    expect(files.has(`${OLD}/interactions/x.jsonl`)).toBe(true);
  });

  it("is idempotent on repeated calls", async () => {
    const { app, files, writeLog } = createMockApp();
    await seed(app, `${OLD}/data.json`, '{"v":1}');

    const first = await migratePluginFolder(app, OLD_ID, NEW_ID);
    expect(first.skipped).toBeNull();
    expect(first.copied).toEqual(["data.json"]);
    const writesAfterFirst = writeLog.length;

    // Simulate the user modifying settings after migration.
    await app.vault.adapter.write(`${NEW}/data.json`, '{"v":2}');
    const writesAfterEdit = writeLog.length;

    const second = await migratePluginFolder(app, OLD_ID, NEW_ID);
    expect(second.skipped).toBe("already-migrated");
    expect(second.copied).toEqual([]);
    expect(writeLog.length).toBe(writesAfterEdit);
    // And the post-migration edit is preserved.
    expect(files.get(`${NEW}/data.json`)?.content).toBe('{"v":2}');
    expect(writesAfterFirst).toBeGreaterThan(0);
  });

  it("works when only chats.json exists in the old folder (no data.json)", async () => {
    const { app, files } = createMockApp();
    await seed(app, `${OLD}/chats.json`, '[{"id":"x"}]');

    const result = await migratePluginFolder(app, OLD_ID, NEW_ID);

    expect(result.skipped).toBeNull();
    expect(result.copied).toEqual(["chats.json"]);
    expect(files.get(`${NEW}/chats.json`)?.content).toBe('[{"id":"x"}]');
  });

  it("respects a custom configDir", async () => {
    const { app, files } = createMockApp();
    app.vault.configDir = ".config/obsidian";
    await seed(app, ".config/obsidian/plugins/llm-wiki-plugin/data.json", '{"k":"v"}');

    const result = await migratePluginFolder(app, OLD_ID, NEW_ID);

    expect(result.skipped).toBeNull();
    expect(
      files.get(".config/obsidian/plugins/lm-wiki/data.json")?.content,
    ).toBe('{"k":"v"}');
  });
});

describe("migratePluginFolder — chained 1.0.4 + 1.0.6 sequence", () => {
  // Reproduces the loop in plugin.ts onload: try "llm-wiki-plugin" → "lm-wiki"
  // first (newer source), then fall back to "llm-wiki" → "lm-wiki" (older).
  async function runChained(app: ReturnType<typeof createMockApp>["app"]) {
    const results = [];
    for (const oldId of ["llm-wiki-plugin", "llm-wiki"]) {
      const r = await migratePluginFolder(app, oldId, "lm-wiki");
      results.push({ oldId, ...r });
      if (r.copied.length > 0) break;
    }
    return results;
  }

  it("prefers the newer (llm-wiki-plugin) folder when both have data", async () => {
    const { app, files } = createMockApp();
    await seed(app, ".obsidian/plugins/llm-wiki/data.json", '{"src":"old-llm-wiki"}');
    await seed(app, ".obsidian/plugins/llm-wiki-plugin/data.json", '{"src":"llm-wiki-plugin"}');

    const results = await runChained(app);

    expect(results).toHaveLength(1);
    expect(results[0].oldId).toBe("llm-wiki-plugin");
    expect(results[0].copied).toContain("data.json");
    expect(files.get(".obsidian/plugins/lm-wiki/data.json")?.content).toBe(
      '{"src":"llm-wiki-plugin"}',
    );
  });

  it("falls back to the older (llm-wiki) folder when llm-wiki-plugin is empty", async () => {
    const { app, files } = createMockApp();
    await seed(app, ".obsidian/plugins/llm-wiki/data.json", '{"src":"old-llm-wiki"}');

    const results = await runChained(app);

    expect(results).toHaveLength(2);
    expect(results[0].skipped).toBe("fresh-install");
    expect(results[1].oldId).toBe("llm-wiki");
    expect(results[1].copied).toContain("data.json");
    expect(files.get(".obsidian/plugins/lm-wiki/data.json")?.content).toBe(
      '{"src":"old-llm-wiki"}',
    );
  });

  it("no-ops on truly fresh installs (no old folders)", async () => {
    const { app, files } = createMockApp();
    const results = await runChained(app);
    expect(results).toHaveLength(2);
    expect(results[0].skipped).toBe("fresh-install");
    expect(results[1].skipped).toBe("fresh-install");
    expect(files.has(".obsidian/plugins/lm-wiki/data.json")).toBe(false);
  });

  it("is idempotent after lm-wiki/data.json already exists (re-run scenario)", async () => {
    const { app, files } = createMockApp();
    await seed(app, ".obsidian/plugins/lm-wiki/data.json", '{"already":true}');
    await seed(app, ".obsidian/plugins/llm-wiki-plugin/data.json", '{"stale":true}');
    await seed(app, ".obsidian/plugins/llm-wiki/data.json", '{"older":true}');

    const results = await runChained(app);

    expect(results).toHaveLength(2);
    expect(results[0].skipped).toBe("already-migrated");
    expect(results[1].skipped).toBe("already-migrated");
    expect(files.get(".obsidian/plugins/lm-wiki/data.json")?.content).toBe(
      '{"already":true}',
    );
  });
});
