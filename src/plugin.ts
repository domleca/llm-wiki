import { Notice, Plugin, TFile } from "obsidian";
import { KnowledgeBase } from "./core/kb.js";
import { loadKB, saveKB } from "./vault/kb-store.js";
import { walkVaultFiles, type WalkOptions } from "./vault/walker.js";
import { openVocabularyModal } from "./ui/modal/vocabulary-modal.js";
import { OllamaProvider } from "./llm/ollama.js";
import type { LLMProvider } from "./llm/provider.js";
import { runExtraction, type QueueFile } from "./extract/queue.js";
import { extractFile } from "./extract/extractor.js";
import {
  DEFAULT_MIN_FILE_SIZE,
  DEFAULT_SKIP_DIRS,
  defaultDailiesFromIso,
} from "./extract/defaults.js";
import { ProgressEmitter } from "./runtime/progress.js";
import { StatusBarWidget } from "./ui/status-bar.js";
import { LlmWikiSettingsTab } from "./ui/settings/settings-tab.js";

interface LlmWikiSettings {
  version: number;
  ollamaUrl: string;
  ollamaModel: string;
  extractionCharLimit: number;
  lastExtractionRunIso: string | null;
  embeddingModel: string;
  defaultQueryFolder: string;
  recentQuestionCount: number;
  showSourceLinks: boolean;
}

const DEFAULT_SETTINGS: LlmWikiSettings = {
  version: 1,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  extractionCharLimit: 12_000,
  lastExtractionRunIso: null,
  embeddingModel: "nomic-embed-text",
  defaultQueryFolder: "",
  recentQuestionCount: 5,
  showSourceLinks: true,
};

export default class LlmWikiPlugin extends Plugin {
  settings: LlmWikiSettings = DEFAULT_SETTINGS;
  kb: KnowledgeBase = new KnowledgeBase();
  kbMtime = 0;

  progress = new ProgressEmitter();
  private provider: LLMProvider = new OllamaProvider({
    url: this.settings.ollamaUrl,
  });
  private abortController: AbortController | null = null;
  private running = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.rebuildProvider();
    await this.reloadKB();

    // Status bar
    const statusEl = this.addStatusBarItem();
    new StatusBarWidget(statusEl, this.progress);

    // Settings tab
    this.addSettingTab(new LlmWikiSettingsTab(this.app, this));

    // Commands
    this.addCommand({
      id: "show-vocabulary",
      name: "LLM Wiki: Show vocabulary",
      callback: () => openVocabularyModal(this.app, this.kb),
    });

    this.addCommand({
      id: "reload-kb",
      name: "LLM Wiki: Reload knowledge base from disk",
      callback: () => {
        void this.reloadKB();
      },
    });

    this.addCommand({
      id: "extract-all",
      name: "LLM Wiki: Run extraction now",
      callback: () => {
        void this.runExtractAll();
      },
    });

    this.addCommand({
      id: "extract-current",
      name: "LLM Wiki: Extract current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (checking) return true;
        void this.runExtractCurrent(file);
        return true;
      },
    });

    this.addCommand({
      id: "extract-cancel",
      name: "LLM Wiki: Cancel running extraction",
      checkCallback: (checking) => {
        if (checking) return this.running;
        this.cancelExtraction();
        return true;
      },
    });
  }

  onunload(): void {
    this.cancelExtraction();
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<LlmWikiSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async reloadKB(): Promise<void> {
    const { kb, mtime } = await loadKB(this.app as never);
    this.kb = kb;
    this.kbMtime = mtime;
  }

  /** Called by the settings UI when the Ollama URL changes. */
  rebuildProvider(): void {
    this.provider = new OllamaProvider({ url: this.settings.ollamaUrl });
  }

  isExtractionRunning(): boolean {
    return this.running;
  }

  cancelExtraction(): void {
    if (this.abortController) this.abortController.abort();
  }

  async runExtractAll(): Promise<void> {
    if (this.running) {
      new Notice("LLM Wiki: extraction already running.");
      return;
    }
    this.running = true;
    this.abortController = new AbortController();

    try {
      await this.reloadKB();
      const walkOpts: WalkOptions = {
        skipDirs: DEFAULT_SKIP_DIRS,
        minFileSize: DEFAULT_MIN_FILE_SIZE,
        dailiesFromIso: defaultDailiesFromIso(),
      };
      const walked = await walkVaultFiles(this.app as never, walkOpts);
      const files: QueueFile[] = [];
      for (const w of walked) {
        const tfile = this.app.vault.getAbstractFileByPath(w.path);
        if (!(tfile instanceof TFile)) continue;
        const content = await this.app.vault.cachedRead(tfile);
        files.push({
          path: w.path,
          content,
          mtime: w.mtime,
          origin: w.origin,
        });
      }

      const saveCallback = async (): Promise<void> => {
        await saveKB(this.app as never, this.kb, this.kbMtime);
        const reloaded = await loadKB(this.app as never);
        this.kbMtime = reloaded.mtime;
      };

      const stats = await runExtraction({
        provider: this.provider,
        kb: this.kb,
        files,
        model: this.settings.ollamaModel,
        saveKB: saveCallback,
        emitter: this.progress,
        checkpointEvery: 5,
        charLimit: this.settings.extractionCharLimit,
        signal: this.abortController.signal,
      });

      this.settings.lastExtractionRunIso = new Date().toISOString();
      await this.saveSettings();
      new Notice(
        `LLM Wiki: ${stats.succeeded} extracted, ${stats.failed} failed, ${stats.skipped} skipped (${Math.round(stats.elapsedMs / 1000)}s).`,
      );
    } catch (e) {
      this.progress.emit("batch-errored", {
        message: (e as Error).message ?? "Unknown error",
      });
      new Notice(`LLM Wiki: extraction failed — ${(e as Error).message}`);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  async runExtractCurrent(file: TFile): Promise<void> {
    if (this.running) {
      new Notice("LLM Wiki: wait for the current extraction to finish.");
      return;
    }
    this.running = true;
    this.abortController = new AbortController();
    try {
      await this.reloadKB();
      const content = await this.app.vault.cachedRead(file);
      await extractFile({
        provider: this.provider,
        kb: this.kb,
        file: {
          path: file.path,
          content,
          mtime: file.stat.mtime,
          origin: "user-note",
        },
        model: this.settings.ollamaModel,
        signal: this.abortController.signal,
        charLimit: this.settings.extractionCharLimit,
      });
      await saveKB(this.app as never, this.kb, this.kbMtime);
      const reloaded = await loadKB(this.app as never);
      this.kbMtime = reloaded.mtime;
      new Notice(`LLM Wiki: extracted ${file.path}.`);
    } catch (e) {
      new Notice(`LLM Wiki: extract failed — ${(e as Error).message}`);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }
}
