import { describe, it, expect } from "vitest";
import { rrfFuse } from "../../src/query/rrf.js";
import type { RankedItem } from "../../src/query/types.js";

describe("rrfFuse", () => {
  it("fuses two ranked lists with weights", () => {
    const list1: RankedItem[] = [
      { id: "a", score: 10 },
      { id: "b", score: 5 },
    ];
    const list2: RankedItem[] = [
      { id: "b", score: 8 },
      { id: "a", score: 4 },
    ];
    const fused = rrfFuse([list1, list2], [1.0, 1.0], 60);
    expect(fused[0]?.id).toBe("a"); // a is rank 0 in list1 + rank 1 in list2
    expect(fused.length).toBe(2);
  });

  it("respects per-list weights", () => {
    const list1: RankedItem[] = [{ id: "a", score: 1 }];
    const list2: RankedItem[] = [{ id: "b", score: 1 }];
    const fused = rrfFuse([list1, list2], [10.0, 0.1], 60);
    expect(fused[0]?.id).toBe("a");
  });

  it("handles empty lists", () => {
    expect(rrfFuse([], [], 60)).toEqual([]);
    expect(rrfFuse([[]], [1.0], 60)).toEqual([]);
  });
});
