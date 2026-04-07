import { Setting } from "obsidian";
import type { FilterSettings } from "../../core/filters.js";

export function renderFiltersSection(
  containerEl: HTMLElement,
  settings: FilterSettings,
  onChange: (patch: Partial<FilterSettings>) => Promise<void>,
): void {
  containerEl.createEl("h3", { text: "Quality filters" });

  new Setting(containerEl)
    .setName("Min facts per entity")
    .setDesc("Entities with fewer facts will not get a wiki page.")
    .addText((text) =>
      text
        .setValue(String(settings.minFactsPerEntity))
        .onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 0) {
            await onChange({ minFactsPerEntity: n });
          }
        }),
    );

  new Setting(containerEl)
    .setName("Min sources per entity")
    .setDesc("Entities referenced by fewer sources will not get a wiki page.")
    .addText((text) =>
      text
        .setValue(String(settings.minSourcesPerEntity))
        .onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 0) {
            await onChange({ minSourcesPerEntity: n });
          }
        }),
    );

  new Setting(containerEl)
    .setName("Skip clipping-only entities")
    .setDesc(
      "When enabled, entities whose sources are all clippings are excluded.",
    )
    .addToggle((toggle) =>
      toggle.setValue(settings.skipClippingOnly).onChange(async (value) => {
        await onChange({ skipClippingOnly: value });
      }),
    );
}
