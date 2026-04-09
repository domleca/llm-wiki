/**
 * Settings UI section for model selection — unified across Ollama and
 * cloud providers. Shows a picker with autocomplete.
 */

import { App, Setting, SuggestModal } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";
import { completionModels, type CatalogEntry } from "../../llm/catalog.js";
import type { CloudProvider } from "../../llm/catalog.js";
import { openModelPicker } from "../modal/model-picker.js";

export interface ModelsSectionHandlers {
  rerender: () => void;
}

export function renderModelsSection(
  containerEl: HTMLElement,
  plugin: LlmWikiPlugin,
  handlers: ModelsSectionHandlers,
): void {
  containerEl.createEl("h2", { text: "Model" });

  const pt = plugin.settings.providerType;

  if (pt === "ollama") {
    // Ollama: use existing dynamic model picker (fetches from server)
    new Setting(containerEl)
      .setName("Ollama model")
      .setDesc(`Current: ${plugin.settings.ollamaModel}`)
      .addButton((btn) =>
        btn.setButtonText("Change…").onClick(() => {
          void openModelPicker({
            app: plugin.app,
            provider: plugin.provider,
            current: plugin.settings.ollamaModel,
            onPick: async (model) => {
              plugin.settings.ollamaModel = model;
              await plugin.saveSettings();
              handlers.rerender();
            },
          });
        }),
      );
  } else {
    // Cloud provider: pick from catalog
    const cloudProvider = pt as CloudProvider;
    const current = plugin.settings.cloudModel || "(none)";

    new Setting(containerEl)
      .setName("Model")
      .setDesc(`Current: ${current}`)
      .addButton((btn) =>
        btn.setButtonText("Change…").onClick(() => {
          const models = completionModels(cloudProvider);
          new CloudModelPickerModal(
            plugin.app,
            models,
            plugin.settings.cloudModel,
            async (model) => {
              plugin.settings.cloudModel = model;
              await plugin.saveSettings();
              handlers.rerender();
            },
          ).open();
        }),
      );
  }
}

/**
 * SuggestModal for cloud model selection from the static catalog.
 */
class CloudModelPickerModal extends SuggestModal<CatalogEntry> {
  constructor(
    app: App,
    private readonly models: readonly CatalogEntry[],
    private readonly current: string,
    private readonly onPick: (modelId: string) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder("Search models…");
    this.emptyStateText = "No matching models.";
    this.modalEl.addClass("llm-wiki-centered-suggest");
  }

  getSuggestions(query: string): CatalogEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...this.models];
    return this.models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q),
    );
  }

  renderSuggestion(entry: CatalogEntry, el: HTMLElement): void {
    el.createEl("div", { text: entry.label });
    el.createEl("small", {
      text: `${entry.id} · ${formatCtx(entry.contextLength)}`,
      cls: "llm-wiki-model-picker-hint",
    });
    if (entry.id === this.current) {
      el.createEl("small", {
        text: " (current)",
        cls: "llm-wiki-model-picker-hint",
      });
    }
  }

  onChooseSuggestion(entry: CatalogEntry): void {
    void this.onPick(entry.id);
  }
}

function formatCtx(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`;
  return `${tokens} ctx`;
}
