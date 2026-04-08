import { App, PluginSettingTab } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";
import { renderIndexingSection } from "./indexing-section.js";
import { buildQuerySection } from "./query-section.js";
import { renderFiltersSection } from "./filters-section.js";

export class LlmWikiSettingsTab extends PluginSettingTab {
  private readonly plugin: LlmWikiPlugin;

  constructor(app: App, plugin: LlmWikiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h1", { text: "LLM Wiki" });
    containerEl.createEl("p", {
      text: "Phase 2 — Extraction. Query, filters, and cloud providers arrive in later phases.",
    });

    renderIndexingSection(containerEl, this.plugin, {
      onIndexAll: () => this.plugin.runExtractAll(),
      onIndexCancel: () => this.plugin.cancelExtraction(),
      isRunning: () => this.plugin.isExtractionRunning(),
    });

    buildQuerySection({
      container: containerEl,
      settings: {
        embeddingModel: this.plugin.settings.embeddingModel,
        defaultQueryFolder: this.plugin.settings.defaultQueryFolder,
        prebuildEmbeddingIndex: this.plugin.settings.prebuildEmbeddingIndex,
      },
      onChange: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.plugin.saveSettings();
      },
    });

    renderFiltersSection(
      containerEl,
      this.plugin.settings.filterSettings,
      async (patch) => {
        Object.assign(this.plugin.settings.filterSettings, patch);
        await this.plugin.saveSettings();
      },
    );
  }
}
