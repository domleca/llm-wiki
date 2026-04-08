/**
 * Persists chats to `chats.json` via the safe-write plugin-data layer.
 * Replaces the older `recent-questions.json` store.
 */
import {
  safeReadPluginData,
  safeWritePluginData,
  type SafeWriteApp,
} from "../vault/safe-write.js";
import type { Chat } from "./types.js";

const FILE = "chats.json";

export async function loadChats(app: SafeWriteApp): Promise<Chat[]> {
  const raw = await safeReadPluginData(app, FILE);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Chat =>
        !!c &&
        typeof c === "object" &&
        typeof (c as Chat).id === "string" &&
        Array.isArray((c as Chat).turns),
    );
  } catch {
    return [];
  }
}

export async function saveChats(
  app: SafeWriteApp,
  chats: readonly Chat[],
): Promise<void> {
  await safeWritePluginData(app, FILE, JSON.stringify(chats, null, 2));
}
