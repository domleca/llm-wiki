/**
 * Static catalog of well-known cloud models. Ollama models are discovered
 * dynamically via `listModels()` — this catalog covers OpenAI, Anthropic,
 * Google, and Mistral models whose identifiers and capabilities are stable.
 */

export type CloudProvider = "openai" | "anthropic" | "google" | "mistral";

export interface CatalogEntry {
  /** Model identifier sent to the API (e.g. "gpt-4o"). */
  id: string;
  /** Human-friendly label shown in pickers. */
  label: string;
  /** Which cloud provider serves this model. */
  provider: CloudProvider;
  /** Context window in tokens. */
  contextLength: number;
  /** Whether this model supports text completion / chat. */
  canComplete: boolean;
  /** Whether this model supports embeddings. */
  canEmbed: boolean;
}

// ── OpenAI ──────────────────────────────────────────────────────────────

const openai: CatalogEntry[] = [
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    contextLength: 128_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    contextLength: 128_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    provider: "openai",
    contextLength: 1_047_576,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    provider: "openai",
    contextLength: 1_047_576,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "gpt-4.1-nano",
    label: "GPT-4.1 nano",
    provider: "openai",
    contextLength: 1_047_576,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    provider: "openai",
    contextLength: 200_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "text-embedding-3-small",
    label: "Embedding v3 small",
    provider: "openai",
    contextLength: 8_191,
    canComplete: false,
    canEmbed: true,
  },
  {
    id: "text-embedding-3-large",
    label: "Embedding v3 large",
    provider: "openai",
    contextLength: 8_191,
    canComplete: false,
    canEmbed: true,
  },
];

// ── Anthropic ───────────────────────────────────────────────────────────

const anthropic: CatalogEntry[] = [
  {
    id: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    provider: "anthropic",
    contextLength: 200_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "claude-haiku-4-20250414",
    label: "Claude Haiku 4",
    provider: "anthropic",
    contextLength: 200_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku",
    provider: "anthropic",
    contextLength: 200_000,
    canComplete: true,
    canEmbed: false,
  },
];

// ── Google ───────────────────────────────────────────────────────────────

const google: CatalogEntry[] = [
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    contextLength: 1_048_576,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
    contextLength: 1_048_576,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash Lite",
    provider: "google",
    contextLength: 1_048_576,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "text-embedding-004",
    label: "Text Embedding 004",
    provider: "google",
    contextLength: 2_048,
    canComplete: false,
    canEmbed: true,
  },
];

// ── Mistral ──────────────────────────────────────────────────────────────

const mistral: CatalogEntry[] = [
  {
    id: "ministral-3b-latest",
    label: "Ministral 3B (fastest)",
    provider: "mistral",
    contextLength: 128_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "ministral-8b-latest",
    label: "Ministral 8B",
    provider: "mistral",
    contextLength: 128_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "mistral-small-latest",
    label: "Mistral Small",
    provider: "mistral",
    contextLength: 128_000,
    canComplete: true,
    canEmbed: false,
  },
  {
    id: "mistral-embed",
    label: "Mistral Embed",
    provider: "mistral",
    contextLength: 8_192,
    canComplete: false,
    canEmbed: true,
  },
];

// ── Public API ──────────────────────────────────────────────────────────

const ALL_ENTRIES: readonly CatalogEntry[] = [
  ...openai,
  ...anthropic,
  ...google,
  ...mistral,
];

/** All catalog entries. */
export function allModels(): readonly CatalogEntry[] {
  return ALL_ENTRIES;
}

/** Entries for a single provider. */
export function modelsForProvider(
  provider: CloudProvider,
): readonly CatalogEntry[] {
  return ALL_ENTRIES.filter((e) => e.provider === provider);
}

/** Completion-capable models for a provider. */
export function completionModels(
  provider: CloudProvider,
): readonly CatalogEntry[] {
  return ALL_ENTRIES.filter(
    (e) => e.provider === provider && e.canComplete,
  );
}

/** Embedding-capable models for a provider (empty for Anthropic). */
export function embeddingModels(
  provider: CloudProvider,
): readonly CatalogEntry[] {
  return ALL_ENTRIES.filter(
    (e) => e.provider === provider && e.canEmbed,
  );
}

/** Look up a single model by its exact id. */
export function findModel(id: string): CatalogEntry | undefined {
  return ALL_ENTRIES.find((e) => e.id === id);
}

/** Default completion model for each provider. */
export function defaultCompletionModel(provider: CloudProvider): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-haiku-20241022";
    case "google":
      return "gemini-2.0-flash";
    case "mistral":
      return "ministral-3b-latest";
  }
}

/** Default embedding model for each provider (falls back to null for Anthropic). */
export function defaultEmbeddingModel(
  provider: CloudProvider,
): string | null {
  switch (provider) {
    case "openai":
      return "text-embedding-3-small";
    case "anthropic":
      return null; // no embedding API — uses Ollama fallback
    case "google":
      return "text-embedding-004";
    case "mistral":
      return "mistral-embed";
  }
}

/**
 * Fuzzy-match catalog entries against a query string. Returns entries
 * whose id or label contains the query (case-insensitive), sorted by
 * label. Used for autocomplete in the model picker.
 */
export function searchModels(
  query: string,
  provider?: CloudProvider,
): readonly CatalogEntry[] {
  const q = query.trim().toLowerCase();
  let pool = provider
    ? ALL_ENTRIES.filter((e) => e.provider === provider)
    : [...ALL_ENTRIES];
  if (q) {
    pool = pool.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.label.toLowerCase().includes(q),
    );
  }
  return pool.sort((a, b) => a.label.localeCompare(b.label));
}
