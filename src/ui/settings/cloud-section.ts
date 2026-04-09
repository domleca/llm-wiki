/**
 * Settings UI section for cloud provider configuration: provider picker,
 * API key entry with auto-validation.
 */

import { Setting } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";
import type { CloudProvider } from "../../llm/catalog.js";
import type { ProviderType } from "../../plugin.js";
import { detectProvider, validateKey } from "../../llm/detect-key.js";
import { defaultCompletionModel } from "../../llm/catalog.js";

export interface CloudSectionHandlers {
  rerender: () => void;
}

const PROVIDER_LABELS: Record<ProviderType, string> = {
  ollama: "Ollama (local)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

const PROVIDER_OPTIONS: ProviderType[] = [
  "ollama",
  "openai",
  "anthropic",
  "google",
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
        if (value !== "ollama" && !plugin.settings.cloudModel) {
          plugin.settings.cloudModel = defaultCompletionModel(
            value as CloudProvider,
          );
        }
        await plugin.saveSettings();
        plugin.rebuildProvider();
        handlers.rerender();
      });
    });

  // ── API key entry (only for cloud providers) ──────────────────────
  const pt = plugin.settings.providerType;
  if (pt === "ollama") return;

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
        if (!trimmed || trimmed === masked) return;
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
