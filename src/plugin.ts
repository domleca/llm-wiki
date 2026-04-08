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
import { Scheduler } from "./runtime/scheduler.js";
import { StatusBarWidget } from "./ui/status-bar.js";
import {
  defaultFilterSettings,
  type FilterSettings,
} from "./core/filters.js";
import { LlmWikiSettingsTab } from "./ui/settings/settings-tab.js";
import {
  loadEmbeddingsCache,
  saveEmbeddingsCache,
  type EmbeddingsCache,
} from "./vault/plugin-data.js";
import { appendInteractionLog } from "./vault/interaction-log.js";
import { loadChats, saveChats } from "./chat/persistence.js";
import type { Chat } from "./chat/types.js";
import { QueryModal } from "./ui/modal/query-modal.js";
import { buildEmbeddingIndex } from "./query/embeddings.js";
import { EmbeddingIndexController } from "./query/embedding-index-controller.js";
import { generatePages, sourcePagePath } from "./pages/generator.js";
import { safeDeletePage } from "./vault/safe-write.js";

interface LlmWikiSettings {
  version: number;
  ollamaUrl: string;
  ollamaModel: string;
  extractionCharLimit: number;
  lastExtractionRunIso: string | null;
  embeddingModel: string;
  defaultQueryFolder: string;
  prebuildEmbeddingIndex: boolean;
  filterSettings: FilterSettings;
  nightlyExtractionEnabled: boolean;
  nightlyExtractionHour: number;
}

const DEFAULT_SETTINGS: LlmWikiSettings = {
  version: 1,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  extractionCharLimit: 12_000,
  lastExtractionRunIso: null,
  embeddingModel: "nomic-embed-text",
  defaultQueryFolder: "",
  prebuildEmbeddingIndex: true,
  filterSettings: defaultFilterSettings(),
  nightlyExtractionEnabled: false,
  nightlyExtractionHour: 2,
};

/** Delay before kicking off the background pre-build, so plugin load stays snappy. */
const PREBUILD_DELAY_MS = 2000;

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
  private chats: Chat[] = [];
  private embeddingsCache: EmbeddingsCache | null = null;
  private embeddingIndexController: EmbeddingIndexController | null = null;
  private prebuildTimer: number | null = null;
  private scheduler: Scheduler | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.rebuildProvider();
    await this.reloadKB();
    this.chats = await loadChats(this.app);
    this.embeddingIndexController = this.createIndexController();

    // Status bar
    const statusEl = this.addStatusBarItem();
    new StatusBarWidget(statusEl, this.progress);

    // Settings tab
    this.addSettingTab(new LlmWikiSettingsTab(this.app, this));

    // Ribbon icon — open the query modal
    this.addRibbonIcon("rainbow", "Ask knowledge base", () => {
      this.openQueryModal();
    });

    // Commands
    this.addCommand({
      id: "run-query",
      name: "Ask knowledge base",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "k" }],
      callback: () => {
        this.openQueryModal();
      },
    });

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

    this.addCommand({
      id: "regenerate-pages",
      name: "LLM Wiki: Regenerate pages from KB",
      callback: () => {
        void this.runRegeneratePages();
      },
    });

    // Vault event: delete — remove source from KB and regenerate pages
    this.registerEvent(
      this.app.vault.on("delete", (abstractFile) => {
        if (!(abstractFile instanceof TFile)) return;
        if (abstractFile.extension !== "md") return;
        this.kb.removeSource(abstractFile.path);
        void (async () => {
          try {
            await saveKB(this.app as never, this.kb, this.kbMtime);
            const r = await loadKB(this.app as never);
            this.kbMtime = r.mtime;
            await generatePages(
              this.app as never,
              this.kb,
              this.settings.filterSettings,
            );
          } catch {
            // best-effort
          }
        })();
      }),
    );

    // Vault event: rename — update source path in KB and regenerate pages
    this.registerEvent(
      this.app.vault.on("rename", (abstractFile, oldPath) => {
        if (!(abstractFile instanceof TFile)) return;
        if (abstractFile.extension !== "md") return;
        const oldSourcePage = sourcePagePath(oldPath);
        this.kb.renameSource(oldPath, abstractFile.path);
        void (async () => {
          try {
            await saveKB(this.app as never, this.kb, this.kbMtime);
            const r = await loadKB(this.app as never);
            this.kbMtime = r.mtime;
            await safeDeletePage(this.app as never, oldSourcePage);
            await generatePages(
              this.app as never,
              this.kb,
              this.settings.filterSettings,
            );
          } catch {
            // best-effort
          }
        })();
      }),
    );

    // Nightly extraction scheduler. Wait for the workspace to be ready so the
    // missed-run catch-up doesn't race the rest of plugin startup.
    this.app.workspace.onLayoutReady(() => {
      this.startScheduler();
    });

    if (this.settings.prebuildEmbeddingIndex) {
      this.prebuildTimer = window.setTimeout(() => {
        this.prebuildTimer = null;
        void this.embeddingIndexController?.ensureBuilt();
      }, PREBUILD_DELAY_MS);
    }
  }

  onunload(): void {
    this.cancelExtraction();
    this.stopScheduler();
    if (this.prebuildTimer !== null) {
      window.clearTimeout(this.prebuildTimer);
      this.prebuildTimer = null;
    }
  }

  startScheduler(): void {
    this.stopScheduler();
    if (!this.settings.nightlyExtractionEnabled) return;
    this.scheduler = new Scheduler({
      hour: this.settings.nightlyExtractionHour,
      getLastRunIso: () => this.settings.lastExtractionRunIso,
      isExtractionRunning: () => this.running,
      trigger: () => {
        void this.runExtractAll();
      },
    });
    this.scheduler.start();
  }

  stopScheduler(): void {
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
    }
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

  private createIndexController(): EmbeddingIndexController {
    return new EmbeddingIndexController({
      buildIndex: async (onProgress) => {
        if (!this.embeddingsCache) {
          this.embeddingsCache = await loadEmbeddingsCache(this.app);
        }
        const index = await buildEmbeddingIndex({
          kb: this.kb,
          provider: this.provider,
          model: this.settings.embeddingModel,
          cache: this.embeddingsCache,
          onProgress,
        });
        await saveEmbeddingsCache(this.app, this.embeddingsCache);
        return index;
      },
    });
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
      await generatePages(
        this.app as never,
        this.kb,
        this.settings.filterSettings,
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

  private openQueryModal(): void {
    if (!this.kb) {
      new Notice("LLM Wiki: knowledge base not loaded yet");
      return;
    }
    if (!this.embeddingIndexController) {
      this.embeddingIndexController = this.createIndexController();
    }

    const modal = new QueryModal({
      app: this.app,
      kb: this.kb,
      provider: this.provider,
      model: this.settings.ollamaModel,
      folder: this.settings.defaultQueryFolder,
      chats: this.chats,
      activeChatId: null,
      indexController: this.embeddingIndexController,
      onChatsChanged: (chats): void => {
        this.chats = [...chats];
        void saveChats(this.app, this.chats);
      },
      onAnswered: ({ question, answer, bundle, elapsedMs }): void => {
        void appendInteractionLog(this.app, {
          question,
          answer,
          model: this.settings.ollamaModel,
          queryType: bundle.queryType,
          entityCount: bundle.entities.length,
          conceptCount: bundle.concepts.length,
          elapsedMs,
        });
      },
    });
    modal.open();
  }

  async runRegeneratePages(): Promise<void> {
    try {
      const result = await generatePages(
        this.app as never,
        this.kb,
        this.settings.filterSettings,
      );
      new Notice(
        `LLM Wiki: ${result.written} pages written, ${result.deleted} deleted.`,
      );
    } catch (e) {
      new Notice(`LLM Wiki: page generation failed — ${(e as Error).message}`);
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
      await generatePages(
        this.app as never,
        this.kb,
        this.settings.filterSettings,
      );
    } catch (e) {
      new Notice(`LLM Wiki: extract failed — ${(e as Error).message}`);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }
}
