import { App, PluginSettingTab } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";
import { renderIndexingSection } from "./indexing-section.js";

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
  }
}
