/**
 * One-time migration: when the plugin's manifest id changed from
 * "llm-wiki" to "llm-wiki-plugin" in 1.0.4, Obsidian started reading
 * runtime data from a new folder. This copies the user's data out of
 * the old folder so settings, chats, embeddings cache, and interaction
 * logs survive the rename.
 *
 * Copies, never moves: leaves the old folder intact as a backup the
 * user can delete manually once they're confident the new bundle works.
 *
 * Idempotent: if the new folder already has data.json, the user has
 * already saved settings under the new id, so we skip.
 *
 * Whitelist-only: we copy known user-data filenames and the
 * interactions/ directory. Code files (main.js, manifest.json,
 * styles.css) and anything else stays put.
 */

import type { SafeWriteApp } from "./safe-write.js";

/** Filenames in the old plugin folder that hold user data we want to preserve. */
const MIGRATION_FILES: readonly string[] = Object.freeze([
  "data.json",
  "chats.json",
  "embeddings-cache.json",
  "recent-questions.json",
]);

/** Subdirectories in the old plugin folder that we copy recursively. */
const MIGRATION_DIRS: readonly string[] = Object.freeze(["interactions"]);

export type MigrationSkipReason =
  | "fresh-install"
  | "already-migrated"
  | "nothing-to-migrate";

export interface MigrationResult {
  /** Human-readable names of what was copied. Empty if nothing copied. */
  copied: string[];
  /** Set when we did nothing; null when at least one file was copied. */
  skipped: MigrationSkipReason | null;
}

export async function migratePluginFolder(
  app: SafeWriteApp,
  oldId: string,
  newId: string,
): Promise<MigrationResult> {
  const configDir = app.vault.configDir;
  const oldDir = `${configDir}/plugins/${oldId}`;
  const newDir = `${configDir}/plugins/${newId}`;

  // Idempotency: data.json in the new folder means Obsidian has already
  // saved settings under the new id, either because migration already ran
  // or because the user has been using the renamed plugin. Either way,
  // don't overwrite.
  if (await app.vault.adapter.exists(`${newDir}/data.json`)) {
    return { copied: [], skipped: "already-migrated" };
  }

  // Detect "no old data to migrate" by checking the most likely user-data
  // files. We can't reliably probe directory existence via the adapter, but
  // these two files cover virtually every prior-install scenario.
  const hasOldData = await app.vault.adapter.exists(`${oldDir}/data.json`);
  const hasOldChats = await app.vault.adapter.exists(`${oldDir}/chats.json`);
  if (!hasOldData && !hasOldChats) {
    return { copied: [], skipped: "fresh-install" };
  }

  const copied: string[] = [];

  for (const file of MIGRATION_FILES) {
    const srcPath = `${oldDir}/${file}`;
    const dstPath = `${newDir}/${file}`;
    if (!(await app.vault.adapter.exists(srcPath))) continue;
    const content = await app.vault.adapter.read(srcPath);
    await ensureDir(app, parentDir(dstPath));
    await app.vault.adapter.write(dstPath, content);
    copied.push(file);
  }

  for (const dir of MIGRATION_DIRS) {
    const srcDir = `${oldDir}/${dir}`;
    const dstDir = `${newDir}/${dir}`;
    const fileCount = await copyDirRecursive(app, srcDir, dstDir);
    if (fileCount > 0) {
      copied.push(`${dir}/ (${fileCount} file${fileCount === 1 ? "" : "s"})`);
    }
  }

  if (copied.length === 0) {
    return { copied: [], skipped: "nothing-to-migrate" };
  }
  return { copied, skipped: null };
}

async function copyDirRecursive(
  app: SafeWriteApp,
  src: string,
  dst: string,
): Promise<number> {
  let entries: { files: string[]; folders: string[] };
  try {
    entries = await app.vault.adapter.list(src);
  } catch {
    // Real Obsidian's adapter throws when the path does not exist.
    return 0;
  }
  if (entries.files.length === 0 && entries.folders.length === 0) {
    return 0;
  }
  await ensureDir(app, dst);
  let count = 0;
  for (const filePath of entries.files) {
    const name = basename(filePath);
    const content = await app.vault.adapter.read(filePath);
    await app.vault.adapter.write(`${dst}/${name}`, content);
    count++;
  }
  for (const folderPath of entries.folders) {
    const name = basename(folderPath);
    count += await copyDirRecursive(app, folderPath, `${dst}/${name}`);
  }
  return count;
}

async function ensureDir(app: SafeWriteApp, dir: string): Promise<void> {
  if (!dir) return;
  if (!(await app.vault.adapter.exists(dir))) {
    await app.vault.adapter.mkdir(dir);
  }
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}
