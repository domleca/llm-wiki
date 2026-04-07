import { describe, it, expect } from "vitest";
import { applyQuerySettingsPatch } from "../../../src/ui/settings/query-section.js";

describe("applyQuerySettingsPatch", () => {
  it("merges patch into existing settings", () => {
    const before = {
      embeddingModel: "old",
      defaultQueryFolder: "",
      recentQuestionCount: 5,
      showSourceLinks: true,
      prebuildEmbeddingIndex: true,
    };
    const after = applyQuerySettingsPatch(before, {
      embeddingModel: "new",
    });
    expect(after.embeddingModel).toBe("new");
    expect(after.recentQuestionCount).toBe(5);
    expect(after.defaultQueryFolder).toBe("");
    expect(after.showSourceLinks).toBe(true);
    expect(after.prebuildEmbeddingIndex).toBe(true);
  });

  it("clamps recentQuestionCount to [0, 50]", () => {
    const before = {
      embeddingModel: "x",
      defaultQueryFolder: "",
      recentQuestionCount: 5,
      showSourceLinks: true,
      prebuildEmbeddingIndex: true,
    };
    expect(
      applyQuerySettingsPatch(before, { recentQuestionCount: -3 })
        .recentQuestionCount,
    ).toBe(0);
    expect(
      applyQuerySettingsPatch(before, { recentQuestionCount: 9999 })
        .recentQuestionCount,
    ).toBe(50);
    expect(
      applyQuerySettingsPatch(before, { recentQuestionCount: 25 })
        .recentQuestionCount,
    ).toBe(25);
  });

  it("does not mutate the previous settings object", () => {
    const before = {
      embeddingModel: "old",
      defaultQueryFolder: "",
      recentQuestionCount: 5,
      showSourceLinks: true,
      prebuildEmbeddingIndex: true,
    };
    applyQuerySettingsPatch(before, {
      embeddingModel: "new",
      recentQuestionCount: 12,
    });
    expect(before.embeddingModel).toBe("old");
    expect(before.recentQuestionCount).toBe(5);
    expect(before.prebuildEmbeddingIndex).toBe(true);
  });

  it("preserves prebuildEmbeddingIndex when patched to false", () => {
    const before = {
      embeddingModel: "x",
      defaultQueryFolder: "",
      recentQuestionCount: 5,
      showSourceLinks: true,
      prebuildEmbeddingIndex: true,
    };
    expect(
      applyQuerySettingsPatch(before, { prebuildEmbeddingIndex: false })
        .prebuildEmbeddingIndex,
    ).toBe(false);
  });
});
