/**
 * Settings UI section for cloud provider configuration: provider picker,
 * API key entry with auto-validation.
 */

import { completionModels, defaultCompletionModel } from "../../llm/catalog.js";
import { detectProvider, validateKey } from "../../llm/detect-key.js";

import type { CloudProvider } from "../../llm/catalog.js";
import type LlmWikiPlugin from "../../plugin.js";
import type { ProviderType } from "../../plugin.js";
import { Setting } from "obsidian";

export interface CloudSectionHandlers {
  rerender: () => void;
}

const PROVIDER_LABELS: Record<ProviderType, string> = {
  ollama: "Ollama (local)",
  "openai-compatible": "OpenAI-compatible (custom)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  mistral: "Mistral",
};

const PROVIDER_OPTIONS: ProviderType[] = [
  "ollama",
  "openai-compatible",
  "openai",
  "anthropic",
  "google",
  "mistral",
];

export function renderCloudSection(
  containerEl: HTMLElement,
  plugin: LlmWikiPlugin,
  handlers: CloudSectionHandlers,
): void {
  containerEl.createEl("h2", { text: "Model" });

  // ── Provider picker ───────────────────────────────────────────────
  new Setting(containerEl)
    .setName("LLM provider")
    .setDesc("Choose between a local Ollama server or a cloud API.")
    .addDropdown((dropdown) => {
      for (const p of PROVIDER_OPTIONS) {
        dropdown.addOption(p, PROVIDER_LABELS[p]);
      }
      dropdown.setValue(plugin.settings.providerType);
      dropdown.onChange(async (value) => {
        plugin.settings.providerType = value as ProviderType;
        if (value === "openai-compatible") {
          if (!plugin.settings.customOpenAIModel) {
            plugin.settings.customOpenAIModel = "gpt-4o-mini";
          }
        } else if (value !== "ollama" && !plugin.settings.cloudModel) {
          plugin.settings.cloudModel = defaultCompletionModel(
            value as CloudProvider,
          );
        } else if (value !== "ollama") {
          const provider = value as CloudProvider;
          const valid = completionModels(provider).some(
            (m) => m.id === plugin.settings.cloudModel,
          );
          if (!valid) {
            plugin.settings.cloudModel = defaultCompletionModel(provider);
          }
        }
        await plugin.saveSettings();
        plugin.rebuildProvider();
        handlers.rerender();
      });
    });

  // ── API key entry (only for cloud providers) ──────────────────────
  const pt = plugin.settings.providerType;
  if (pt === "ollama") return;

  if (pt === "openai-compatible") {
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Endpoint root for your OpenAI-compatible API (for example: https://api.groq.com).")
      .addText((text) =>
        text
          .setPlaceholder("https://...")
          .setValue(plugin.settings.customOpenAIBaseUrl)
          .onChange(async (value) => {
            plugin.settings.customOpenAIBaseUrl = value.trim();
            await plugin.saveSettings();
            plugin.rebuildProvider();
          }),
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Optional for self-hosted providers. Stored locally in this vault's data.json.")
      .addText((text) =>
        text
          .setPlaceholder("Paste your API key…")
          .setValue(
            plugin.settings.customOpenAIApiKey
              ? maskKey(plugin.settings.customOpenAIApiKey)
              : "",
          )
          .onChange(async (value) => {
            const trimmed = value.trim();
            const masked = maskKey(plugin.settings.customOpenAIApiKey);
            if (trimmed === masked) return;
            plugin.settings.customOpenAIApiKey = trimmed;
            await plugin.saveSettings();
            plugin.rebuildProvider();
            handlers.rerender();
          }),
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Completion model used for extraction and chat.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. gpt-4o-mini")
          .setValue(plugin.settings.customOpenAIModel)
          .onChange(async (value) => {
            plugin.settings.customOpenAIModel = value.trim();
            await plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc("Optional. Defaults to the completion model if left blank.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. text-embedding-3-small")
          .setValue(plugin.settings.customOpenAIEmbeddingModel)
          .onChange(async (value) => {
            plugin.settings.customOpenAIEmbeddingModel = value.trim();
            await plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Models endpoint")
      .setDesc("Path or absolute URL for model listing. Default: /v1/models")
      .addText((text) =>
        text
          .setPlaceholder("/v1/models")
          .setValue(plugin.settings.customOpenAIModelsEndpoint)
          .onChange(async (value) => {
            plugin.settings.customOpenAIModelsEndpoint = value.trim() || "/v1/models";
            await plugin.saveSettings();
            plugin.rebuildProvider();
          }),
      );

    new Setting(containerEl)
      .setName("Completions endpoint")
      .setDesc("Path or absolute URL for text generation. Chat completions and legacy completions are both supported.")
      .addText((text) =>
        text
          .setPlaceholder("/v1/chat/completions")
          .setValue(plugin.settings.customOpenAICompletionsEndpoint)
          .onChange(async (value) => {
            plugin.settings.customOpenAICompletionsEndpoint =
              value.trim() || "/v1/chat/completions";
            await plugin.saveSettings();
            plugin.rebuildProvider();
          }),
      );

    new Setting(containerEl)
      .setName("Embeddings endpoint")
      .setDesc("Path or absolute URL for embeddings. Default: /v1/embeddings")
      .addText((text) =>
        text
          .setPlaceholder("/v1/embeddings")
          .setValue(plugin.settings.customOpenAIEmbeddingsEndpoint)
          .onChange(async (value) => {
            plugin.settings.customOpenAIEmbeddingsEndpoint =
              value.trim() || "/v1/embeddings";
            await plugin.saveSettings();
            plugin.rebuildProvider();
          }),
      );

    return;
  }

  const providerKey = pt as CloudProvider;
  const currentKey = plugin.settings.apiKeys[providerKey] ?? "";
  const cached = plugin.keyValidationCache[providerKey];
  const masked = currentKey ? maskKey(currentKey) : "";

  const keySetting = new Setting(containerEl).setName(
    `${PROVIDER_LABELS[pt]} API key`,
  );

  // Description: "Current: sk-p••••-XgA" colored by validation state
  if (currentKey) {
    const descEl = keySetting.descEl;
    const statusCls = cached
      ? cached.valid
        ? "llm-wiki-key-valid"
        : "llm-wiki-key-invalid"
      : "llm-wiki-key-validating";

    descEl.createSpan({
      text: `Current: ${masked}`,
      cls: statusCls,
    });

    // Mismatch warning
    const detected = detectProvider(currentKey);
    if (detected !== null && detected !== providerKey) {
      descEl.createEl("br");
      descEl.createSpan({
        text: `This looks like a ${PROVIDER_LABELS[detected]} key.`,
        cls: "llm-wiki-key-invalid",
      });
    }

    // Kick off validation if not yet cached
    if (!cached) {
      void validateKey(providerKey, currentKey).then((err) => {
        plugin.keyValidationCache[providerKey] = {
          valid: err === null,
          error: err,
        };
        handlers.rerender();
      });
    }
  } else {
    keySetting.setDesc("No API key set.");
  }

  // Text field: shows the masked key so it doesn't feel like it vanished
  keySetting.addText((text) =>
    text
      .setPlaceholder("Paste your API key…")
      .setValue(masked)
      .onChange(async (value) => {
        const trimmed = value.trim();
        if (trimmed === masked) return;
        plugin.settings.apiKeys[providerKey] = trimmed;
        delete plugin.keyValidationCache[providerKey];
        await plugin.saveSettings();
        plugin.rebuildProvider();
        handlers.rerender();
      }),
  );

  // ── Privacy & security notes ──────────────────────────────────────
  const privacyEl = containerEl.createEl("p", {
    cls: "setting-item-description llm-wiki-privacy-note",
  });
  privacyEl.setText(
    "When using a cloud provider, note content is sent to that provider's servers during extraction and queries. " +
      "Use Ollama if your notes must stay on your machine.",
  );

  const keyNoteEl = containerEl.createEl("p", {
    cls: "setting-item-description llm-wiki-security-note",
  });
  keyNoteEl.setText(
    "API keys are stored in this vault's data.json — local to your machine, not synced by Obsidian Sync.",
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}
