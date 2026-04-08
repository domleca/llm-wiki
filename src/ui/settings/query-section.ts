import { App, Setting } from "obsidian";
import { folderLabel, openFolderPicker } from "../modal/folder-picker.js";

export interface QuerySettings {
  defaultQueryFolder: string;
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

  new Setting(args.container)
    .setName("Default folder")
    .setDesc(
      `Restrict queries to this vault folder. Current: ${folderLabel(args.settings.defaultQueryFolder)}`,
    )
    .addButton((btn) =>
      btn.setButtonText("Change…").onClick(() => {
        openFolderPicker({
          app: args.app,
          current: args.settings.defaultQueryFolder,
          onPick: async (folder) => {
            await args.onChange({ defaultQueryFolder: folder });
            args.rerender();
          },
        });
      }),
    );
}
