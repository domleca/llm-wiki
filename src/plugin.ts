import { Plugin } from "obsidian";
import { loadKB } from "./vault/kb-store.js";
import { openVocabularyModal } from "./ui/modal/vocabulary-modal.js";
import { KnowledgeBase } from "./core/kb.js";

interface LlmWikiSettings {
  // Phase 1: empty. Phases 2-6 add fields.
  version: number;
}

const DEFAULT_SETTINGS: LlmWikiSettings = {
  version: 1,
};

export default class LlmWikiPlugin extends Plugin {
  settings: LlmWikiSettings = DEFAULT_SETTINGS;
  kb: KnowledgeBase = new KnowledgeBase();
  kbMtime = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.reloadKB();

    this.addCommand({
      id: "show-vocabulary",
      name: "LLM Wiki: Show vocabulary",
      callback: () => {
        openVocabularyModal(this.app, this.kb);
      },
    });

    this.addCommand({
      id: "reload-kb",
      name: "LLM Wiki: Reload knowledge base from disk",
      callback: () => {
        void this.reloadKB();
      },
    });
  }

  async reloadKB(): Promise<void> {
    const { kb, mtime } = await loadKB(this.app as never);
    this.kb = kb;
    this.kbMtime = mtime;
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<LlmWikiSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
