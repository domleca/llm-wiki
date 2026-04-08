import { Setting } from "obsidian";

export interface QuerySettings {
  embeddingModel: string;
  defaultQueryFolder: string;
  prebuildEmbeddingIndex: boolean;
}

export function applyQuerySettingsPatch(
  prev: QuerySettings,
  patch: Partial<QuerySettings>,
): QuerySettings {
  return { ...prev, ...patch };
}

export interface BuildQuerySectionArgs {
  container: HTMLElement;
  settings: QuerySettings;
  onChange: (patch: Partial<QuerySettings>) => void | Promise<void>;
}

export function buildQuerySection(args: BuildQuerySectionArgs): void {
  args.container.createEl("h3", { text: "Query" });

  new Setting(args.container)
    .setName("Embedding model")
    .setDesc("Ollama model used to vectorize entities and questions")
    .addText((t) =>
      t.setValue(args.settings.embeddingModel).onChange((v: string) => {
        void args.onChange({ embeddingModel: v.trim() });
      }),
    );

  new Setting(args.container)
    .setName("Default folder")
    .setDesc("Restrict queries to this vault folder (empty = whole vault)")
    .addText((t) =>
      t.setValue(args.settings.defaultQueryFolder).onChange((v: string) => {
        void args.onChange({ defaultQueryFolder: v.trim() });
      }),
    );

  new Setting(args.container)
    .setName("Pre-build embedding index on startup")
    .setDesc(
      "Build the embedding index in the background a moment after Obsidian launches, so the first query modal opens instantly. Disable to keep startup quiet at the cost of a one-time build on the first query.",
    )
    .addToggle((t) =>
      t.setValue(args.settings.prebuildEmbeddingIndex).onChange((v: boolean) => {
        void args.onChange({ prebuildEmbeddingIndex: v });
      }),
    );
}
