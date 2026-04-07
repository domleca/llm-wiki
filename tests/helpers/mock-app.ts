/**
 * Minimal in-memory fake of the subset of Obsidian's App API used by the
 * vault layer. Backed by a Map so tests can inspect what was written.
 *
 * Mirrors the real Obsidian API closely enough that production code does
 * not need to know it is talking to a mock.
 */
export interface FakeFile {
  path: string;
  content: string;
  mtime: number;
  ctime: number;
}

export interface FakeApp {
  vault: {
    getMarkdownFiles(): FakeFile[];
    cachedRead(file: FakeFile): Promise<string>;
    create(path: string, content: string): Promise<FakeFile>;
    modify(file: FakeFile, content: string): Promise<void>;
    delete(file: FakeFile): Promise<void>;
    adapter: {
      exists(path: string): Promise<boolean>;
      read(path: string): Promise<string>;
      write(path: string, content: string): Promise<void>;
      mkdir(path: string): Promise<void>;
      stat(path: string): Promise<{ mtime: number; size: number } | null>;
    };
  };
  fileManager: {
    processFrontMatter(
      file: FakeFile,
      cb: (fm: Record<string, unknown>) => void,
    ): Promise<void>;
  };
}

export function createMockApp(initial: FakeFile[] = []): {
  app: FakeApp;
  files: Map<string, FakeFile>;
  writeLog: { path: string; content: string }[];
} {
  const files = new Map<string, FakeFile>();
  for (const f of initial) files.set(f.path, f);
  const writeLog: { path: string; content: string }[] = [];

  const app: FakeApp = {
    vault: {
      getMarkdownFiles: () =>
        Array.from(files.values()).filter((f) => f.path.endsWith(".md")),
      cachedRead: async (file) => {
        const f = files.get(file.path);
        if (!f) throw new Error(`File not found: ${file.path}`);
        return f.content;
      },
      create: async (path, content) => {
        const file: FakeFile = {
          path,
          content,
          mtime: Date.now(),
          ctime: Date.now(),
        };
        files.set(path, file);
        writeLog.push({ path, content });
        return file;
      },
      modify: async (file, content) => {
        file.content = content;
        file.mtime = Date.now();
        files.set(file.path, file);
        writeLog.push({ path: file.path, content });
      },
      delete: async (file) => {
        files.delete(file.path);
      },
      adapter: {
        exists: async (path) => files.has(path),
        read: async (path) => {
          const f = files.get(path);
          if (!f) throw new Error(`File not found: ${path}`);
          return f.content;
        },
        write: async (path, content) => {
          const existing = files.get(path);
          if (existing) {
            existing.content = content;
            existing.mtime = Date.now();
          } else {
            files.set(path, {
              path,
              content,
              mtime: Date.now(),
              ctime: Date.now(),
            });
          }
          writeLog.push({ path, content });
        },
        mkdir: async (_path) => {
          // no-op for the mock
        },
        stat: async (path) => {
          const f = files.get(path);
          if (!f) return null;
          return { mtime: f.mtime, size: f.content.length };
        },
      },
    },
    fileManager: {
      processFrontMatter: async (file, cb) => {
        // For the mock, frontmatter is whatever the test wants — we just call
        // the callback with an empty object and let the caller capture writes.
        const fm: Record<string, unknown> = {};
        cb(fm);
        // Persist a stringified frontmatter block at the top of the file content
        const yaml = Object.entries(fm)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join("\n");
        file.content = `---\n${yaml}\n---\n${file.content}`;
        files.set(file.path, file);
      },
    },
  };

  return { app, files, writeLog };
}
