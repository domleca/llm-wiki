import { Setting } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";

export interface IndexingSectionHandlers {
  onIndexAll: () => void;
  onIndexCancel: () => void;
  isRunning: () => boolean;
}

export function renderIndexingSection(
  containerEl: HTMLElement,
  plugin: LlmWikiPlugin,
  handlers: IndexingSectionHandlers,
): void {
  containerEl.createEl("h2", { text: "Indexing" });

  new Setting(containerEl)
    .setName("Ollama URL")
    .setDesc("Base URL of your local Ollama server.")
    .addText((text) =>
      text
        .setPlaceholder("http://localhost:11434")
        .setValue(plugin.settings.ollamaUrl)
        .onChange(async (value) => {
          plugin.settings.ollamaUrl = value.trim() || "http://localhost:11434";
          await plugin.saveSettings();
          plugin.rebuildProvider();
        }),
    );

  new Setting(containerEl)
    .setName("Ollama model")
    .setDesc(
      "Tag of the Ollama model to use for extraction (e.g. qwen2.5:7b). Phase 5 adds a curated picker.",
    )
    .addText((text) =>
      text
        .setPlaceholder("qwen2.5:7b")
        .setValue(plugin.settings.ollamaModel)
        .onChange(async (value) => {
          plugin.settings.ollamaModel = value.trim() || "qwen2.5:7b";
          await plugin.saveSettings();
        }),
    );

  new Setting(containerEl)
    .setName("Last run")
    .setDesc(
      plugin.settings.lastExtractionRunIso
        ? new Date(plugin.settings.lastExtractionRunIso).toLocaleString()
        : "never",
    );

  new Setting(containerEl)
    .setName("Index now")
    .setDesc("Walks the vault and extracts new or modified files.")
    .addButton((btn) =>
      btn
        .setButtonText("Run extraction")
        .setCta()
        .setDisabled(handlers.isRunning())
        .onClick(() => {
          handlers.onIndexAll();
        }),
    );

  new Setting(containerEl)
    .setName("Cancel running extraction")
    .setDesc("Stops the extraction at the next file boundary.")
    .addButton((btn) =>
      btn
        .setButtonText("Cancel")
        .setWarning()
        .setDisabled(!handlers.isRunning())
        .onClick(() => {
          handlers.onIndexCancel();
        }),
    );
}
