import { describe, it, expect } from "vitest";
import { applyQuerySettingsPatch } from "../../../src/ui/settings/query-section.js";

describe("applyQuerySettingsPatch", () => {
  it("merges patch into existing settings", () => {
    const before = {
      embeddingModel: "old",
      defaultQueryFolder: "",
      prebuildEmbeddingIndex: true,
    };
    const after = applyQuerySettingsPatch(before, {
      embeddingModel: "new",
    });
    expect(after.embeddingModel).toBe("new");
    expect(after.defaultQueryFolder).toBe("");
    expect(after.prebuildEmbeddingIndex).toBe(true);
  });

  it("does not mutate the previous settings object", () => {
    const before = {
      embeddingModel: "old",
      defaultQueryFolder: "",
      prebuildEmbeddingIndex: true,
    };
    applyQuerySettingsPatch(before, {
      embeddingModel: "new",
    });
    expect(before.embeddingModel).toBe("old");
    expect(before.prebuildEmbeddingIndex).toBe(true);
  });

  it("preserves prebuildEmbeddingIndex when patched to false", () => {
    const before = {
      embeddingModel: "x",
      defaultQueryFolder: "",
      prebuildEmbeddingIndex: true,
    };
    expect(
      applyQuerySettingsPatch(before, { prebuildEmbeddingIndex: false })
        .prebuildEmbeddingIndex,
    ).toBe(false);
  });
});
