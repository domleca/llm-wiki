import { Setting } from "obsidian";
import type LlmWikiPlugin from "../../plugin.js";
import type { ExtractionLanguageSetting } from "../../plugin.js";

export interface IndexingSectionHandlers {
  onIndexAll: () => void;
  onIndexCancel: () => void;
  isRunning: () => boolean;
  rerender: () => void;
}

export function renderIndexingSection(
  containerEl: HTMLElement,
  plugin: LlmWikiPlugin,
  handlers: IndexingSectionHandlers,
): void {
  containerEl.createEl("h2", { text: "Indexing" });

  // ── Ollama URL (only visible when Ollama is the active provider) ──
  if (plugin.settings.providerType === "ollama") {
    new Setting(containerEl)
      .setName("Ollama URL")
      .setDesc("Base URL of your local Ollama server.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(plugin.settings.ollamaUrl)
          .onChange(async (value) => {
            plugin.settings.ollamaUrl =
              value.trim() || "http://localhost:11434";
            await plugin.saveSettings();
            plugin.rebuildProvider();
          }),
      );
  }

  // ── Index now / cancel ────────────────────────────────────────────
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
    .setName("Extraction language")
    .setDesc(
      `Language used for extracted summaries, facts, and definitions. Current output: ${plugin.extractionOutputLanguage}.`,
    )
    .addDropdown((dropdown) => {
      for (const [value, label] of EXTRACTION_LANGUAGE_OPTIONS) {
        dropdown.addOption(value, label);
      }
      dropdown.setValue(plugin.settings.extractionOutputLanguage);
      dropdown.onChange(async (value) => {
        plugin.settings.extractionOutputLanguage =
          value as ExtractionLanguageSetting;
        await plugin.saveSettings();
        handlers.rerender();
      });
    });

  // ── Daily refresh ─────────────────────────────────────────────────
  new Setting(containerEl)
    .setName("Daily refresh")
    .setDesc(
      "Quietly processes changes and new notes in your vault once per day. Missed runs (machine asleep) catch up at next launch.",
    )
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.nightlyExtractionEnabled)
        .onChange(async (value) => {
          plugin.settings.nightlyExtractionEnabled = value;
          await plugin.saveSettings();
          plugin.startScheduler();
          handlers.rerender();
        }),
    );

  if (plugin.settings.nightlyExtractionEnabled) {
    new Setting(containerEl)
      .setName("Daily refresh hour")
      .setDesc("Hour of day (0–23, local time) at which the daily refresh fires.")
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
}

const EXTRACTION_LANGUAGE_OPTIONS: ReadonlyArray<
  [ExtractionLanguageSetting, string]
> = [
  ["app", "Auto (use Obsidian language)"],
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["de", "German"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["pt", "Portuguese"],
];
