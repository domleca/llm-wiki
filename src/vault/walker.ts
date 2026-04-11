import type { SourceOrigin } from "../core/types.js";
import { isInAnyFolder } from "./path-scope.js";

export interface WalkOptions {
  skipDirs: string[];
  includeFolders?: string[];
  minFileSize: number;
  /** ISO date YYYY-MM-DD; daily notes older than this are skipped. */
  dailiesFromIso: string;
}

export interface WalkedFile {
  path: string;
  mtime: number;
  size: number;
  origin: SourceOrigin;
}

/**
 * Minimal Obsidian-vault interface for walking files. The real App's
 * `vault.getMarkdownFiles()` returns TFile objects with .path / .stat;
 * the mock app returns the same shape.
 */
interface WalkerApp {
  vault: {
    getMarkdownFiles(): Array<{
      path: string;
      mtime?: number;
      ctime?: number;
      content?: string;
      stat?: { mtime: number; size: number };
    }>;
  };
}

export async function walkVaultFiles(
  app: WalkerApp,
  opts: WalkOptions,
): Promise<WalkedFile[]> {
  const all = app.vault.getMarkdownFiles();
  const skipSet = new Set(opts.skipDirs.map((d) => d.toLowerCase()));
  const includeFolders = opts.includeFolders ?? [];
  const result: WalkedFile[] = [];

  for (const f of all) {
    const parts = f.path.split("/");
    if (parts.some((p) => skipSet.has(p.toLowerCase()))) continue;
    if (!isInAnyFolder(f.path, includeFolders)) continue;

    const size =
      f.stat?.size ??
      (typeof f.content === "string" ? f.content.length : 0);
    if (size < opts.minFileSize) continue;

    const isDaily = parts.some((p) => p.toLowerCase() === "dailies");
    if (isDaily) {
      const dateIso = parseDailyDate(f.path);
      if (!dateIso || dateIso < opts.dailiesFromIso) continue;
    }

    const mtime = f.stat?.mtime ?? f.mtime ?? f.ctime ?? 0;

    result.push({
      path: f.path,
      mtime,
      size,
      origin: deriveOrigin(parts),
    });
  }

  return result;
}

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/**
 * Parses filenames like "06 April 2026.md" → "2026-04-06".
 * Returns null if the filename is not a recognizable daily date.
 */
function parseDailyDate(path: string): string | null {
  const filename = path.split("/").pop() ?? "";
  const stem = filename.replace(/\.md$/i, "");
  const match = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(stem);
  if (!match) return null;
  const day = match[1]!.padStart(2, "0");
  const monthName = match[2]!.toLowerCase();
  const year = match[3]!;
  const month = MONTHS[monthName];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function deriveOrigin(parts: string[]): SourceOrigin {
  for (const p of parts) {
    if (p.toLowerCase() === "dailies") return "daily";
  }
  return "user-note";
}
