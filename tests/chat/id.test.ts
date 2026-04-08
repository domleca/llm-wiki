import { describe, it, expect } from "vitest";
import { generateChatId } from "../../src/chat/id.js";

describe("generateChatId", () => {
  it("returns a non-empty string", () => {
    expect(generateChatId().length).toBeGreaterThan(0);
  });
  it("returns unique values across calls", () => {
    expect(generateChatId()).not.toBe(generateChatId());
  });
});
