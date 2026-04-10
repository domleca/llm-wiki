import { describe, it, expect } from "vitest";
import { detectProvider, validateKey } from "../../src/llm/detect-key.js";

describe("detectProvider", () => {
  it("detects OpenAI keys (sk- prefix)", () => {
    expect(detectProvider("sk-proj-abc123")).toBe("openai");
    expect(detectProvider("sk-svcacct-xyz")).toBe("openai");
    expect(detectProvider("sk-1234567890abcdef")).toBe("openai");
  });

  it("detects Anthropic keys (sk-ant- prefix)", () => {
    expect(detectProvider("sk-ant-api03-abc123")).toBe("anthropic");
  });

  it("detects Google keys (AIza prefix)", () => {
    expect(detectProvider("AIzaSyB1234567890")).toBe("google");
  });

  it("detects Mistral keys (mistral- prefix)", () => {
    expect(detectProvider("mistral-abc123")).toBe("mistral");
  });

  it("returns null for unrecognized keys", () => {
    expect(detectProvider("random-key-format")).toBeNull();
    expect(detectProvider("")).toBeNull();
    expect(detectProvider("   ")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(detectProvider("  sk-ant-api03-abc  ")).toBe("anthropic");
  });
});

describe("validateKey", () => {
  it("returns null on successful OpenAI validation", async () => {
    const mockFetch = async () =>
      ({ ok: true, status: 200 }) as Response;
    const result = await validateKey("openai", "sk-test", mockFetch);
    expect(result).toBeNull();
  });

  it("returns error message on 401", async () => {
    const mockFetch = async () =>
      ({ ok: false, status: 401 }) as Response;
    const result = await validateKey("openai", "sk-bad", mockFetch);
    expect(result).toBe("Invalid API key");
  });

  it("returns connection error on fetch throw", async () => {
    const mockFetch = async () => {
      throw new Error("network down");
    };
    const result = await validateKey(
      "openai",
      "sk-test",
      mockFetch as typeof globalThis.fetch,
    );
    expect(result).toBe("Connection failed: network down");
  });

  it("validates Anthropic: 200 or 400 are both success", async () => {
    for (const status of [200, 400]) {
      const mockFetch = async () =>
        ({ ok: status === 200, status }) as Response;
      const result = await validateKey("anthropic", "sk-ant-test", mockFetch);
      expect(result).toBeNull();
    }
  });

  it("validates Google: 200 is success", async () => {
    const mockFetch = async () =>
      ({ ok: true, status: 200 }) as Response;
    const result = await validateKey("google", "AIzaTest", mockFetch);
    expect(result).toBeNull();
  });

  it("validates Google: 403 is invalid key", async () => {
    const mockFetch = async () =>
      ({ ok: false, status: 403 }) as Response;
    const result = await validateKey("google", "AIzaBad", mockFetch);
    expect(result).toBe("Invalid API key");
  });

  it("validates Mistral: 200 is success", async () => {
    const mockFetch = async () =>
      ({ ok: true, status: 200 }) as Response;
    const result = await validateKey("mistral", "mistral-test", mockFetch);
    expect(result).toBeNull();
  });

  it("validates Mistral: 401 is invalid key", async () => {
    const mockFetch = async () =>
      ({ ok: false, status: 401 }) as Response;
    const result = await validateKey("mistral", "mistral-bad", mockFetch);
    expect(result).toBe("Invalid API key");
  });
});
