/**
 * Chat id generator. Uses crypto.randomUUID when available; falls back to a
 * timestamp + random suffix for environments where it isn't.
 */
export function generateChatId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
