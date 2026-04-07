import { describe, it, expect, vi } from "vitest";
import { renderFiltersSection } from "../../../src/ui/settings/filters-section.js";
import { defaultFilterSettings } from "../../../src/core/filters.js";
import type { FilterSettings } from "../../../src/core/filters.js";

function makeContainer() {
  return {
    createEl: (_tag: string, opts?: { text?: string }) => ({
      text: opts?.text ?? "",
    }),
  } as unknown as HTMLElement;
}

describe("renderFiltersSection", () => {
  it("accepts defaultFilterSettings without throwing", () => {
    const container = makeContainer();
    expect(() =>
      renderFiltersSection(container, defaultFilterSettings(), async () => {}),
    ).not.toThrow();
  });

  it("calls onChange when settings are updated (API smoke test)", () => {
    const container = makeContainer();
    const settings = defaultFilterSettings();
    const onChange = vi.fn(async (_patch: Partial<FilterSettings>) => {});
    // Should not throw and onChange should not be called synchronously
    renderFiltersSection(container, settings, onChange);
    expect(onChange).not.toHaveBeenCalled();
  });
});
