import { App, Setting } from "obsidian";
import { folderLabel, openFolderPicker } from "../modal/folder-picker.js";

export interface QuerySettings {
  queryFolders: string[];
}

export function applyQuerySettingsPatch(
  prev: QuerySettings,
  patch: Partial<QuerySettings>,
): QuerySettings {
  return { ...prev, ...patch };
}

export interface BuildQuerySectionArgs {
  app: App;
  container: HTMLElement;
  settings: QuerySettings;
  onChange: (patch: Partial<QuerySettings>) => void | Promise<void>;
  rerender: () => void;
}

export function buildQuerySection(args: BuildQuerySectionArgs): void {
  args.container.createEl("h3", { text: "Query" });

  const desc =
    args.settings.queryFolders.length === 0
      ? "No folder restrictions (searching entire vault)"
      : `Indexing ${args.settings.queryFolders.length} folder${args.settings.queryFolders.length === 1 ? "" : "s"}`;

  new Setting(args.container)
    .setName("Index folders")
    .setDesc(desc)
    .addButton((btn) =>
      btn.setButtonText("Add folder…").onClick(() => {
        openFolderPicker({
          app: args.app,
          current: "",
          onPick: async (folder) => {
            if (folder && !args.settings.queryFolders.includes(folder)) {
              await args.onChange({
                queryFolders: [...args.settings.queryFolders, folder],
              });
              args.rerender();
            }
          },
        });
      }),
    );

  // Display list of current folders with remove buttons
  if (args.settings.queryFolders.length > 0) {
    const listContainer = args.container.createDiv({
      cls: "llm-wiki-folder-list",
    });
    for (const folder of args.settings.queryFolders) {
      const itemContainer = listContainer.createDiv({
        cls: "llm-wiki-folder-list-item",
      });
      itemContainer.createSpan({ text: folder });
      const removeBtn = itemContainer.createEl("button", {
        text: "Remove",
        cls: "llm-wiki-folder-remove-btn",
      });
      removeBtn.addEventListener("click", async () => {
        const filtered = args.settings.queryFolders.filter((f) => f !== folder);
        await args.onChange({ queryFolders: filtered });
        args.rerender();
      });
    }
  }
}
