/**
 * On-save extraction watcher.
 *
 * Listens to vault "modify" events, debounces rapid saves on the same file,
 * filters out files in skip directories (wiki/, .obsidian/, etc.), and
 * triggers single-file extraction when the dust settles.
 */

const DEFAULT_DEBOUNCE_MS = 5_000;

export interface OnSaveWatcherOptions {
  /** Directories to ignore (same list as the walker's skipDirs). */
  skipDirs: string[];
  /** Returns true if a bulk extraction is running — skip on-save in that case. */
  isExtractionRunning: () => boolean;
  /** Called with the file path when a save should trigger extraction. */
  trigger: (path: string) => void;
  /** Debounce delay in ms. Defaults to 5 000. */
  debounceMs?: number;
  /** Injection seam for tests. Defaults to `setTimeout`/`clearTimeout`. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export class OnSaveWatcher {
  private readonly opts: Required<
    Omit<OnSaveWatcherOptions, "setTimeout" | "clearTimeout" | "debounceMs">
  > & {
    debounceMs: number;
    setTimeout: NonNullable<OnSaveWatcherOptions["setTimeout"]>;
    clearTimeout: NonNullable<OnSaveWatcherOptions["clearTimeout"]>;
  };

  /** Pending debounce timers keyed by file path. */
  private pending = new Map<string, unknown>();

  constructor(options: OnSaveWatcherOptions) {
    this.opts = {
      skipDirs: options.skipDirs,
      isExtractionRunning: options.isExtractionRunning,
      trigger: options.trigger,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      setTimeout:
        options.setTimeout ??
        ((fn, ms): unknown => globalThis.setTimeout(fn, ms)),
      clearTimeout:
        options.clearTimeout ??
        ((handle): void => {
          globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
        }),
    };
  }

  /**
   * Call this from the vault "modify" event handler.
   * Only accepts markdown file paths — caller should filter by extension.
   */
  handleModify(path: string): void {
    if (this.isSkipped(path)) return;

    // Reset debounce timer for this file.
    const existing = this.pending.get(path);
    if (existing !== undefined) {
      this.opts.clearTimeout(existing);
    }

    const handle = this.opts.setTimeout(() => {
      this.pending.delete(path);
      if (this.opts.isExtractionRunning()) return;
      this.opts.trigger(path);
    }, this.opts.debounceMs);

    this.pending.set(path, handle);
  }

  /** Cancel all pending timers (called on plugin unload). */
  destroy(): void {
    for (const handle of this.pending.values()) {
      this.opts.clearTimeout(handle);
    }
    this.pending.clear();
  }

  private isSkipped(path: string): boolean {
    const parts = path.split("/");
    const skipSet = new Set(this.opts.skipDirs.map((d) => d.toLowerCase()));
    return parts.some((p) => skipSet.has(p.toLowerCase()));
  }
}
