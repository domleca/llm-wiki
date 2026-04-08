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

  const running = handlers.isRunning();
  const lastRunText = plugin.settings.lastExtractionRunIso
    ? new Date(plugin.settings.lastExtractionRunIso).toLocaleString()
    : "never";

  const indexSetting = new Setting(containerEl)
    .setName("Index now")
    .setDesc("Walks the vault and extracts new or modified files.");

  indexSetting.descEl.createEl("div", {
    text: running ? "Extraction running…" : `Last run: ${lastRunText}`,
    cls: "llm-wiki-indexing-status",
  });

  if (running) {
    indexSetting.addButton((btn) =>
      btn
        .setButtonText("Cancel")
        .setWarning()
        .onClick(() => {
          handlers.onIndexCancel();
        }),
    );
  } else {
    indexSetting.addButton((btn) =>
      btn
        .setButtonText("Run extraction")
        .setCta()
        .onClick(() => {
          handlers.onIndexAll();
        }),
    );
  }

  new Setting(containerEl)
    .setName("Nightly extraction")
    .setDesc(
      "Automatically run extraction once per day. Missed runs (machine asleep at the scheduled hour) catch up at next launch.",
    )
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.nightlyExtractionEnabled)
        .onChange(async (value) => {
          plugin.settings.nightlyExtractionEnabled = value;
          await plugin.saveSettings();
          plugin.startScheduler();
        }),
    );

  new Setting(containerEl)
    .setName("Nightly extraction hour")
    .setDesc("Hour of day (0–23, local time) at which the nightly run fires.")
    .addText((text) =>
      text
        .setPlaceholder("2")
        .setValue(String(plugin.settings.nightlyExtractionHour))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return;
          plugin.settings.nightlyExtractionHour = parsed;
          await plugin.saveSettings();
          plugin.startScheduler();
        }),
    );

}
