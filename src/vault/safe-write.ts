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
    };
  };
}

const PLUGIN_DIR = ".obsidian/plugins/llm-wiki";

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
