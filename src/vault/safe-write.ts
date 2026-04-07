/**
 * The single chokepoint for all plugin file writes.
 *
 * Every helper here validates the target path against the allowlist
 * before any I/O. Lint enforces that no other module calls
 * app.vault.create / modify / adapter.write directly.
 */

export const ALLOWED_PREFIXES: readonly string[] = Object.freeze([
  "wiki/knowledge.json",
  "wiki/index.md",
  "wiki/log.md",
  "wiki/memory.md",
  "wiki/entities/",
  "wiki/concepts/",
  "wiki/sources/",
  ".obsidian/plugins/llm-wiki/",
]);

export class PathNotAllowedError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(
      `Refusing to write to "${path}". Path is not in the LLM Wiki allowlist.`,
    );
    this.name = "PathNotAllowedError";
    this.path = path;
  }
}

/**
 * Returns true iff the given vault-relative path is safe to write to.
 *
 * Rejects:
 *   - empty / root paths
 *   - absolute paths (starting with /)
 *   - paths containing .. segments
 *   - paths that look like an allowlist prefix but are actually look-alikes
 *     (e.g. "wiki-evil/")
 */
export function isAllowedPath(path: string): boolean {
  if (!path || path === "/") return false;
  if (path.startsWith("/")) return false;
  if (path.split("/").includes("..")) return false;
  for (const prefix of ALLOWED_PREFIXES) {
    if (prefix.endsWith("/")) {
      if (path.startsWith(prefix)) return true;
    } else {
      if (path === prefix) return true;
    }
  }
  return false;
}

/**
 * Throws PathNotAllowedError if the path is not allowed.
 * Use this at the top of every safeWrite* helper.
 */
export function assertAllowed(path: string): void {
  if (!isAllowedPath(path)) {
    throw new PathNotAllowedError(path);
  }
}

/**
 * Minimal interface of the Obsidian App methods we need.
 * Tests pass a mock; production passes the real App.
 */
export interface SafeWriteApp {
  vault: {
    adapter: {
      exists(path: string): Promise<boolean>;
      read(path: string): Promise<string>;
      write(path: string, content: string): Promise<void>;
      mkdir(path: string): Promise<void>;
      list(path: string): Promise<{ files: string[]; folders: string[] }>;
      remove(path: string): Promise<void>;
    };
  };
}

export const PLUGIN_DIR = ".obsidian/plugins/llm-wiki";

export async function safeWritePluginData(
  app: SafeWriteApp,
  filename: string,
  content: string,
): Promise<void> {
  if (filename.startsWith("/")) throw new PathNotAllowedError(filename);
  const path = `${PLUGIN_DIR}/${filename}`;
  assertAllowed(path);
  await ensureDir(app, dirname(path));
  await app.vault.adapter.write(path, content);
}

/**
 * Appends a line to a file under `.obsidian/plugins/llm-wiki/`, creating the
 * file (and parent directory) if needed. Unlike `safeWritePluginData`, this
 * preserves existing content — used for JSONL logs such as the interaction log.
 *
 * The line is normalised so the file always ends in exactly one trailing
 * newline: if `line` already ends with `\n` we keep it, otherwise we append
 * one.
 */
export async function safeAppendPluginData(
  app: SafeWriteApp,
  relPath: string,
  line: string,
): Promise<void> {
  if (relPath.startsWith("/") || relPath.split("/").includes("..")) {
    throw new PathNotAllowedError(relPath);
  }
  const fullPath = `${PLUGIN_DIR}/${relPath}`;
  assertAllowed(fullPath);
  const text = line.endsWith("\n") ? line : line + "\n";
  if (await app.vault.adapter.exists(fullPath)) {
    const prior = await app.vault.adapter.read(fullPath);
    await app.vault.adapter.write(fullPath, prior + text);
    return;
  }
  await ensureDir(app, dirname(fullPath));
  await app.vault.adapter.write(fullPath, text);
}

export async function safeReadPluginData(
  app: SafeWriteApp,
  filename: string,
): Promise<string | null> {
  if (filename.startsWith("/")) throw new PathNotAllowedError(filename);
  const path = `${PLUGIN_DIR}/${filename}`;
  assertAllowed(path);
  if (!(await app.vault.adapter.exists(path))) return null;
  return app.vault.adapter.read(path);
}

async function ensureDir(app: SafeWriteApp, dir: string): Promise<void> {
  if (!(await app.vault.adapter.exists(dir))) {
    await app.vault.adapter.mkdir(dir);
  }
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Write a generated wiki page. Path must be under wiki/entities/, wiki/concepts/,
 * wiki/sources/, wiki/index.md, wiki/log.md, or wiki/memory.md.
 */
export async function safeWritePage(
  app: SafeWriteApp,
  relPath: string,
  content: string,
): Promise<void> {
  assertAllowed(relPath);
  await ensureDir(app, dirname(relPath));
  await app.vault.adapter.write(relPath, content);
}

/**
 * Delete a generated wiki page. No-op if the file does not exist.
 */
export async function safeDeletePage(
  app: SafeWriteApp,
  relPath: string,
): Promise<void> {
  assertAllowed(relPath);
  if (await app.vault.adapter.exists(relPath)) {
    await app.vault.adapter.remove(relPath);
  }
}

/**
 * Recursively list all .md file paths under the given allowed prefix.
 * Returns vault-relative paths. Returns [] if the directory doesn't exist.
 */
export async function listPagePaths(
  app: SafeWriteApp,
  prefix: string,
): Promise<string[]> {
  const normalised = prefix.endsWith("/") ? prefix : prefix + "/";
  // Validate the prefix is a known allowed directory prefix
  const allowed = ALLOWED_PREFIXES.some(
    (p) => p.endsWith("/") && normalised.startsWith(p),
  );
  if (!allowed) throw new PathNotAllowedError(prefix);
  return collectMdFiles(app, normalised);
}

async function collectMdFiles(
  app: SafeWriteApp,
  dirPath: string,
): Promise<string[]> {
  const result: string[] = [];
  try {
    const { files, folders } = await app.vault.adapter.list(dirPath);
    for (const f of files) {
      if (f.endsWith(".md")) result.push(f);
    }
    for (const sub of folders) {
      const subPath = sub.endsWith("/") ? sub : sub + "/";
      const subFiles = await collectMdFiles(app, subPath);
      result.push(...subFiles);
    }
  } catch {
    // directory doesn't exist — return empty
  }
  return result;
}
