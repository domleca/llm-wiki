import { App, PluginSettingTab, Setting } from "obsidian";

import type LlmWikiPlugin from "../../plugin.js";
import { buildQuerySection } from "./query-section.js";
import { renderCloudSection } from "./cloud-section.js";
import { renderIndexingSection } from "./indexing-section.js";

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

    renderCloudSection(containerEl, this.plugin, {
      rerender: () => this.display(),
    });

    renderIndexingSection(containerEl, this.plugin, {
      onIndexAll: () => {
        void this.plugin.runExtractAll();
      },
      onIndexCancel: () => this.plugin.cancelExtraction(),
      isRunning: () => this.plugin.isExtractionRunning(),
      rerender: () => this.display(),
    });

    buildQuerySection({
      app: this.app,
      container: containerEl,
      settings: {
        queryFolders: this.plugin.settings.queryFolders,
      },
      onChange: async (patch) => {
        Object.assign(this.plugin.settings, patch);
        await this.plugin.saveSettings();
      },
      rerender: () => this.display(),
    });

    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Show status bar")
      .setDesc("Display the LLM Wiki indicator in the status bar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.showStatusBar = value;
            await this.plugin.saveSettings();
            this.plugin.applyStatusBarVisibility();
          }),
      );

    new Setting(containerEl)
      .setName("Hide wiki from search")
      .setDesc(
        "Exclude generated wiki pages from search, quick switcher, and graph view. Turn off to browse them like regular notes.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideWikiFromSearch)
          .onChange(async (value) => {
            this.plugin.settings.hideWikiFromSearch = value;
            await this.plugin.saveSettings();
            this.plugin.applySearchExclusion();
          }),
      );
  }
}
