/**
 * Settings UI section for cloud provider configuration: provider picker,
 * API key entry, and key validation.
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
  containerEl.createEl("h2", { text: "Provider" });

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
        // Set a sensible default cloud model when switching
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
  const masked = currentKey ? maskKey(currentKey) : "not set";
  const detected = currentKey ? detectProvider(currentKey) : null;
  const mismatch =
    detected !== null && detected !== providerKey
      ? ` (looks like a ${PROVIDER_LABELS[detected]} key)`
      : "";

  const keySetting = new Setting(containerEl)
    .setName(`${PROVIDER_LABELS[pt]} API key`)
    .setDesc(`Current: ${masked}${mismatch}`);

  keySetting.addText((text) =>
    text
      .setPlaceholder("Paste your API key…")
      .setValue("")
      .onChange(async (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        plugin.settings.apiKeys[providerKey] = trimmed;
        await plugin.saveSettings();
        plugin.rebuildProvider();
        handlers.rerender();
      }),
  );

  // ── Validate key button ───────────────────────────────────────────
  if (currentKey) {
    const validateSetting = new Setting(containerEl)
      .setName("Validate key")
      .setDesc("Test that your API key is accepted by the provider.");

    validateSetting.addButton((btn) =>
      btn
        .setButtonText("Test…")
        .setCta()
        .onClick(async () => {
          btn.setButtonText("Testing…");
          btn.setDisabled(true);
          const err = await validateKey(providerKey, currentKey);
          if (err) {
            validateSetting.setDesc(`Key validation failed: ${err}`);
          } else {
            validateSetting.setDesc("Key is valid.");
          }
          btn.setButtonText("Test…");
          btn.setDisabled(false);
        }),
    );
  }

  // ── Privacy & security notes ────────────────────────────────────────
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
