import { App, PluginSettingTab } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";
import { renderCloudSection } from "./cloud-section.js";
import { renderModelsSection } from "./models-section.js";
import { renderIndexingSection } from "./indexing-section.js";
import { buildQuerySection } from "./query-section.js";
import { renderFiltersSection } from "./filters-section.js";

export class LlmWikiSettingsTab extends PluginSettingTab {
  private readonly plugin: LlmWikiPlugin;
  private unsubscribeExtraction: (() => void) | null = null;

  constructor(app: App, plugin: LlmWikiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  hide(): void {
    if (this.unsubscribeExtraction) {
      this.unsubscribeExtraction();
      this.unsubscribeExtraction = null;
    }
  }

  display(): void {
    if (this.unsubscribeExtraction) {
      this.unsubscribeExtraction();
    }
    this.unsubscribeExtraction = this.plugin.onExtractionStateChange(() => {
      this.display();
    });
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Settings" });

    renderCloudSection(containerEl, this.plugin, {
      rerender: () => this.display(),
    });

    renderModelsSection(containerEl, this.plugin, {
      rerender: () => this.display(),
    });

    renderIndexingSection(containerEl, this.plugin, {
      onIndexAll: () => this.plugin.runExtractAll(),
      onIndexCancel: () => this.plugin.cancelExtraction(),
      isRunning: () => this.plugin.isExtractionRunning(),
      rerender: () => this.display(),
    });

    buildQuerySection({
      app: this.app,
      container: containerEl,
      settings: {
        defaultQueryFolder: this.plugin.settings.defaultQueryFolder,
      },
      onChange: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.plugin.saveSettings();
      },
      rerender: () => this.display(),
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
