import { describe, it, expect } from "vitest";
import { sha256Hex } from "../../src/extract/content-hash.js";

describe("sha256Hex", () => {
  it("matches the well-known SHA-256 vector for the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the well-known SHA-256 vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns a 64-character lowercase hex string", async () => {
    const hash = await sha256Hex("some arbitrary note body");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same hash across calls", async () => {
    const a = await sha256Hex("Alan Watts wrote about Zen.");
    const b = await sha256Hex("Alan Watts wrote about Zen.");
    expect(a).toBe(b);
  });

  it("produces different hashes for inputs that differ by one character", async () => {
    const a = await sha256Hex("hello world");
    const b = await sha256Hex("hello worle");
    expect(a).not.toBe(b);
  });

  it("handles non-ASCII (UTF-8 encoded) input", async () => {
    // UTF-8 bytes for "café" are 63 61 66 c3 a9 — five bytes, not four.
    // We just assert determinism and that it differs from the ASCII near-match.
    const accented = await sha256Hex("café");
    const ascii = await sha256Hex("cafe");
    expect(accented).toMatch(/^[0-9a-f]{64}$/);
    expect(accented).not.toBe(ascii);
  });
});
