import { describe, it, expect } from "vitest";
import {
  OLLAMA_HINT_COMMANDS,
  OLLAMA_HINT_INTRO,
} from "../../../src/ui/modal/ollama-hint.js";

describe("ollama-hint", () => {
  it("includes both the brew services and ollama serve commands", () => {
    expect(OLLAMA_HINT_COMMANDS).toContain("brew services start ollama");
    expect(OLLAMA_HINT_COMMANDS).toContain("ollama serve");
  });

  it("intro mentions Ollama and how to relaunch it", () => {
    expect(OLLAMA_HINT_INTRO).toContain("Ollama");
    expect(OLLAMA_HINT_INTRO.toLowerCase()).toContain("relaunch");
  });

  it("commands are in stable display order (brew first, fallback second)", () => {
    expect(OLLAMA_HINT_COMMANDS[0]).toBe("brew services start ollama");
    expect(OLLAMA_HINT_COMMANDS[1]).toBe("ollama serve");
  });
});
