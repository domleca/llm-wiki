import { App, Notice, SuggestModal } from "obsidian";
import type { LLMProvider } from "../../llm/provider.js";

/**
 * Searchable picker for installed Ollama models. Fetches the list live via
 * `provider.listModels()` — there is no stored "configured models" list; the
 * source of truth is whatever Ollama currently has pulled.
 */
export class ModelPickerModal extends SuggestModal<string> {
  constructor(
    app: App,
    private readonly models: readonly string[],
    private readonly current: string,
    private readonly onPick: (model: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Search installed Ollama models…");
    this.emptyStateText = "No matching installed models. Run `ollama pull <tag>` first.";
    this.modalEl.addClass("llm-wiki-centered-suggest");
  }

  getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...this.models];
    return this.models.filter((m) => m.toLowerCase().includes(q));
  }

  renderSuggestion(model: string, el: HTMLElement): void {
    el.createEl("div", { text: model });
    if (model === this.current) {
      el.createEl("small", { text: "current default", cls: "llm-wiki-model-picker-hint" });
    }
  }

  onChooseSuggestion(model: string): void {
    this.onPick(model);
  }
}

/**
 * Opens the model picker. Pings Ollama first; on failure, shows a Notice and
 * aborts rather than opening an empty picker.
 */
export async function openModelPicker(args: {
  app: App;
  provider: LLMProvider;
  current: string;
  onPick: (model: string) => void;
}): Promise<void> {
  if (!args.provider.listModels) {
    new Notice("LLM Wiki: provider does not expose installed models.");
    return;
  }
  const models = await args.provider.listModels();
  if (!models || models.length === 0) {
    new Notice(
      "LLM Wiki: Ollama unreachable or no models installed. Start Ollama and `ollama pull` a model.",
    );
    return;
  }
  new ModelPickerModal(args.app, models, args.current, args.onPick).open();
}
