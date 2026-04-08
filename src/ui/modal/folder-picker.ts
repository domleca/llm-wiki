import { App, SuggestModal, TFolder } from "obsidian";

/** Sentinel value used to represent "the whole vault" (no folder restriction). */
export const WHOLE_VAULT_LABEL = "(whole vault)";

/**
 * Searchable picker over every folder in the vault. The first entry is always
 * the "(whole vault)" sentinel, which resolves to an empty string on pick.
 */
export class FolderPickerModal extends SuggestModal<string> {
  private readonly folders: readonly string[];

  constructor(
    app: App,
    private readonly current: string,
    private readonly onPick: (folder: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Search vault folders…");
    this.folders = collectVaultFolders(app);
    this.modalEl.addClass("llm-wiki-centered-suggest");
  }

  getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    const all = [WHOLE_VAULT_LABEL, ...this.folders];
    if (!q) return all;
    return all.filter((f) => f.toLowerCase().includes(q));
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.createEl("div", { text: folder });
    const effective = folder === WHOLE_VAULT_LABEL ? "" : folder;
    if (effective === this.current) {
      el.createEl("small", {
        text: "current default",
        cls: "llm-wiki-model-picker-hint",
      });
    }
  }

  onChooseSuggestion(folder: string): void {
    this.onPick(folder === WHOLE_VAULT_LABEL ? "" : folder);
  }
}

function collectVaultFolders(app: App): string[] {
  const out: string[] = [];
  for (const f of app.vault.getAllLoadedFiles()) {
    if (f instanceof TFolder && f.path !== "/" && f.path !== "") {
      out.push(f.path);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** Human-readable label for a stored `defaultQueryFolder` value. */
export function folderLabel(folder: string): string {
  return folder || WHOLE_VAULT_LABEL;
}

export function openFolderPicker(args: {
  app: App;
  current: string;
  onPick: (folder: string) => void;
}): void {
  new FolderPickerModal(args.app, args.current, args.onPick).open();
}
