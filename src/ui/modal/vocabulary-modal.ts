import { App, Modal } from "obsidian";
import { KnowledgeBase } from "../../core/kb.js";
import { exportVocabulary } from "../../core/vocabulary.js";

export function openVocabularyModal(app: App, kb: KnowledgeBase): void {
  new VocabularyModal(app, kb).open();
}

class VocabularyModal extends Modal {
  constructor(
    app: App,
    private readonly kb: KnowledgeBase,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "LLM Wiki — Vocabulary" });

    const stats = this.kb.stats();
    contentEl.createEl("p", {
      text: `${stats.entities} entities, ${stats.concepts} concepts, ${stats.connections} connections, ${stats.sources} sources`,
    });

    if (stats.entities === 0 && stats.concepts === 0) {
      contentEl.createEl("p", {
        text: "Knowledge base is empty. Run extraction to populate it (coming in Phase 2).",
      });
      return;
    }

    const pre = contentEl.createEl("pre");
    pre.style.maxHeight = "60vh";
    pre.style.overflow = "auto";
    pre.style.fontSize = "0.85em";
    pre.style.fontFamily = "var(--font-monospace)";
    pre.setText(exportVocabulary(this.kb));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
