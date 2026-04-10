import { App } from "obsidian";
import { openFolderPicker } from "../modal/folder-picker.js";

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

  const wholeVaultDesc = "No folder restrictions (searching entire vault)";

  // Create a setting group for the query folder scope
  const settingGroup = args.container.createDiv({ cls: "setting-group" });

  // Heading with title and add button
  const heading = settingGroup.createDiv({ cls: "setting-item setting-item-heading" });
  heading.createDiv({ cls: "setting-item-name", text: "Query folders" });
  const headingControl = heading.createDiv({ cls: "setting-item-control" });

  const addBtn = headingControl.createEl("button", {
    text: "Add folder…",
    cls: "mod-cta",
  });
  addBtn.addEventListener("click", () => {
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
  });

  // Items container for folders
  const itemsContainer = settingGroup.createDiv({ cls: "setting-items" });

  // Display "Whole vault" when no folders are selected, or list of selected folders
  if (args.settings.queryFolders.length === 0) {
    const settingItem = itemsContainer.createDiv({ cls: "setting-item" });

    const settingInfo = settingItem.createDiv({ cls: "setting-item-info" });
    settingInfo.createDiv({ cls: "setting-item-name", text: "Whole vault" });
    settingInfo.createDiv({ cls: "setting-item-description", text: wholeVaultDesc });
  } else {
    for (const folder of args.settings.queryFolders) {
      const settingItem = itemsContainer.createDiv({ cls: "setting-item" });

      const settingInfo = settingItem.createDiv({ cls: "setting-item-info" });
      settingInfo.createDiv({ cls: "setting-item-name", text: folder });

      const settingControl = settingItem.createDiv({ cls: "setting-item-control" });
      const removeBtn = settingControl.createEl("button", {
        text: "Remove",
        cls: "mod-warning",
      });

      removeBtn.addEventListener("click", async () => {
        const filtered = args.settings.queryFolders.filter((f) => f !== folder);
        await args.onChange({ queryFolders: filtered });
        args.rerender();
      });
    }
  }
}
