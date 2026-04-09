/**
 * API key format detection and lightweight validation.
 *
 * `detectProvider` is synchronous — just pattern matching on the key prefix.
 * `validateKey` makes a single cheap API call to verify the key actually works.
 */

import type { CloudProvider } from "./catalog.js";

/**
 * Guess which provider a key belongs to based on its prefix.
 * Returns null if the key doesn't match any known pattern.
 *
 * Order matters: "sk-ant-" (Anthropic) must be checked before "sk-" (OpenAI)
 * since Anthropic keys also start with "sk-".
 */
export function detectProvider(key: string): CloudProvider | null {
  const trimmed = key.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("sk-")) return "openai";
  if (trimmed.startsWith("AIza")) return "google";

  return null;
}

/**
 * Lightweight key validation — makes one cheap API call per provider to
 * check the key is accepted. Returns a human-readable error on failure,
 * or null on success.
 *
 * Uses the same fetch override seam as the providers (for testability).
 */
export async function validateKey(
  provider: CloudProvider,
  apiKey: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string | null> {
  try {
    switch (provider) {
      case "openai":
        return await validateOpenAI(apiKey, fetchImpl);
      case "anthropic":
        return await validateAnthropic(apiKey, fetchImpl);
      case "google":
        return await validateGoogle(apiKey, fetchImpl);
    }
  } catch (err) {
    return `Connection failed: ${(err as Error).message}`;
  }
}

async function validateOpenAI(
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string | null> {
  const res = await fetchImpl("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.ok) return null;
  if (res.status === 401) return "Invalid API key";
  if (res.status === 429) return "Rate limited — key is valid but quota exceeded";
  return `Unexpected status ${res.status}`;
}

async function validateAnthropic(
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string | null> {
  // Send a minimal messages request — proves the key is accepted.
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  // 200 or 400 (validation error) both mean the key was accepted
  if (res.ok || res.status === 400) return null;
  if (res.status === 401) return "Invalid API key";
  if (res.status === 429) return "Rate limited — key is valid but quota exceeded";
  return `Unexpected status ${res.status}`;
}

async function validateGoogle(
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string | null> {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: "GET" },
  );
  if (res.ok) return null;
  if (res.status === 400 || res.status === 403) return "Invalid API key";
  if (res.status === 429) return "Rate limited — key is valid but quota exceeded";
  return `Unexpected status ${res.status}`;
}
