import { Setting } from "obsidian";

export interface QuerySettings {
  embeddingModel: string;
  defaultQueryFolder: string;
  recentQuestionCount: number;
  showSourceLinks: boolean;
  prebuildEmbeddingIndex: boolean;
}

export function applyQuerySettingsPatch(
  prev: QuerySettings,
  patch: Partial<QuerySettings>,
): QuerySettings {
  const merged = { ...prev, ...patch };
  merged.recentQuestionCount = Math.max(
    0,
    Math.min(50, merged.recentQuestionCount),
  );
  return merged;
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
    .setName("Recent questions to remember")
    .setDesc("How many recent questions to keep in the up/down history (0–50)")
    .addText((t) =>
      t
        .setValue(String(args.settings.recentQuestionCount))
        .onChange((v: string) => {
          const n = Number.parseInt(v, 10);
          if (!Number.isNaN(n)) {
            void args.onChange({ recentQuestionCount: n });
          }
        }),
    );

  new Setting(args.container)
    .setName("Show source links in answer")
    .setDesc("Render source citations as clickable links in the answer body")
    .addToggle((t) =>
      t.setValue(args.settings.showSourceLinks).onChange((v: boolean) => {
        void args.onChange({ showSourceLinks: v });
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
