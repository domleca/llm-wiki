import { describe, it, expect } from "vitest";
import {
  ollamaPingStateFromBool,
  renderOllamaPill,
} from "../../../src/ui/modal/ollama-status-pill.js";

describe("ollamaPingStateFromBool", () => {
  it("maps null → unknown", () => {
    expect(ollamaPingStateFromBool(null)).toBe("unknown");
  });
  it("maps true → on", () => {
    expect(ollamaPingStateFromBool(true)).toBe("on");
  });
  it("maps false → off", () => {
    expect(ollamaPingStateFromBool(false)).toBe("off");
  });
});

describe("renderOllamaPill", () => {
  it("hides the pill in unknown state", () => {
    expect(renderOllamaPill("unknown")).toEqual({ visible: false, text: "" });
  });

  it("hides the pill when on (no clutter when healthy)", () => {
    expect(renderOllamaPill("on")).toEqual({ visible: false, text: "" });
  });

  it("shows 'ollama: off' when off", () => {
    expect(renderOllamaPill("off")).toEqual({
      visible: true,
      text: "ollama: off",
    });
  });
});
