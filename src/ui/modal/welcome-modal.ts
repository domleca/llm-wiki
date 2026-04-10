import { App, Modal } from "obsidian";

export interface WelcomeModalCallbacks {
  onStartNow: () => void;
  onLater: () => void;
}

/**
 * Shown once on first load when no knowledge base exists yet.
 * Gives the user a note count, a time estimate, and two choices:
 * start extraction now or defer to the nightly scheduler.
 */
export class WelcomeModal extends Modal {
  constructor(
    app: App,
    private readonly noteCount: number,
    private readonly isLocal: boolean,
    private readonly callbacks: WelcomeModalCallbacks,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-wiki-welcome-modal");

    contentEl.createEl("h2", { text: "Welcome to LLM Wiki" });

    const introEl = contentEl.createEl("p");
    introEl.appendText("Your vault needs to be indexed before you can ask questions.");
    introEl.createEl("br");
    introEl.appendText(
      "Extraction reads each note and builds a structured knowledge base — " +
      "this only needs to happen once.",
    );

    const estimate = this.formatEstimate();
    const estimateEl = contentEl.createEl("p");
    estimateEl.createEl("strong", { text: `${this.noteCount} notes found` });
    estimateEl.appendText(` — estimated extraction time: ${estimate}.`);

    if (this.isLocal) {
      contentEl.createEl("p", {
        text:
          "This estimate is for local models. Cloud providers (OpenAI, Anthropic, Google) " +
          "are much faster — configure one in Settings > LLM Wiki first if you prefer.",
        cls: "mod-muted",
      });
    }

    const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const laterBtn = btnContainer.createEl("button", { text: "Later" });
    laterBtn.addEventListener("click", () => {
      this.close();
      this.callbacks.onLater();
    });

    const startBtn = btnContainer.createEl("button", {
      text: "Start now",
      cls: "mod-cta",
    });
    startBtn.addEventListener("click", () => {
      this.close();
      this.callbacks.onStartNow();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * Rough estimate based on provider type and note count.
   *
   * Local (Ollama on a typical machine): ~24s per note
   *   (benchmark: 600 notes ≈ 4 hours on M2 Air, qwen2.5:7b)
   * Cloud: ~2s per note (API latency, not compute-bound)
   */
  private formatEstimate(): string {
    const secsPerNote = this.isLocal ? 24 : 2;
    const totalMins = Math.ceil((this.noteCount * secsPerNote) / 60);

    if (totalMins < 2) return "under 2 minutes";
    if (totalMins < 60) return `about ${totalMins} minutes`;

    const hours = totalMins / 60;
    if (hours < 1.5) return "about 1 hour";
    return `about ${Math.round(hours)} hours`;
  }
}
