import { describe, it, expect } from "vitest";
import { applyQuerySettingsPatch } from "../../../src/ui/settings/query-section.js";

describe("applyQuerySettingsPatch", () => {
  it("merges patch into existing settings", () => {
    const before = { defaultQueryFolder: "" };
    const after = applyQuerySettingsPatch(before, {
      defaultQueryFolder: "notes",
    });
    expect(after.defaultQueryFolder).toBe("notes");
  });

  it("does not mutate the previous settings object", () => {
    const before = { defaultQueryFolder: "" };
    applyQuerySettingsPatch(before, { defaultQueryFolder: "notes" });
    expect(before.defaultQueryFolder).toBe("");
  });
});
