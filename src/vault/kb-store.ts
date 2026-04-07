import { KnowledgeBase } from "../core/kb.js";
import type { KBData } from "../core/types.js";
import { assertAllowed, type SafeWriteApp } from "./safe-write.js";

const KB_PATH = "wiki/knowledge.json";

export class KBStaleError extends Error {
  readonly expectedMtime: number;
  readonly actualMtime: number;
  constructor(expected: number, actual: number) {
    super(
      `KB on disk has changed since load (expected mtime ${expected}, actual ${actual}). Reload before retrying.`,
    );
    this.name = "KBStaleError";
    this.expectedMtime = expected;
    this.actualMtime = actual;
  }
}

export interface LoadedKB {
  kb: KnowledgeBase;
  mtime: number;
}

export async function loadKB(app: SafeWriteApp): Promise<LoadedKB> {
  if (!(await app.vault.adapter.exists(KB_PATH))) {
    return { kb: new KnowledgeBase(), mtime: 0 };
  }
  const text = await app.vault.adapter.read(KB_PATH);
  const data = JSON.parse(text) as KBData;
  const stat = await statOrNull(app, KB_PATH);
  return { kb: new KnowledgeBase(data), mtime: stat?.mtime ?? 0 };
}

/**
 * Save the KB to disk. Throws KBStaleError if the file on disk has been
 * modified since `expectedMtime` (i.e. the Python CLI or another instance
 * wrote to it). Caller is responsible for reloading and retrying.
 */
export async function saveKB(
  app: SafeWriteApp,
  kb: KnowledgeBase,
  expectedMtime: number,
): Promise<void> {
  assertAllowed(KB_PATH);
  const stat = await statOrNull(app, KB_PATH);
  if (stat && stat.mtime !== expectedMtime) {
    throw new KBStaleError(expectedMtime, stat.mtime);
  }
  kb.data.meta.updated = new Date().toISOString().slice(0, 10);
  const text = JSON.stringify(kb.data, null, 2);
  await app.vault.adapter.write(KB_PATH, text);
}

interface StatExt {
  mtime: number;
  size: number;
}

async function statOrNull(
  app: SafeWriteApp,
  path: string,
): Promise<StatExt | null> {
  const adapter = app.vault.adapter as unknown as {
    stat?: (p: string) => Promise<StatExt | null>;
  };
  if (typeof adapter.stat !== "function") return null;
  return adapter.stat(path);
}
