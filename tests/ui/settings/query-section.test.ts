import { describe, expect, it } from "vitest";

import { applyQuerySettingsPatch } from "../../../src/ui/settings/query-section.js";

describe("applyQuerySettingsPatch", () => {
  it("merges patch into existing settings", () => {
    const before = { queryFolders: [] };
    const after = applyQuerySettingsPatch(before, {
      queryFolders: ["notes"],
    });
    expect(after.queryFolders).toEqual(["notes"]);
  });

  it("does not mutate the previous settings object", () => {
    const before = { queryFolders: [] };
    applyQuerySettingsPatch(before, { queryFolders: ["notes"] });
    expect(before.queryFolders).toEqual([]);
  });

  it("handles multiple folders", () => {
    const before = { queryFolders: ["projects"] };
    const after = applyQuerySettingsPatch(before, {
      queryFolders: ["projects", "zettel"],
    });
    expect(after.queryFolders).toEqual(["projects", "zettel"]);
  });
});
