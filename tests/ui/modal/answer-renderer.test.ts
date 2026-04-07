import { describe, it, expect, vi } from "vitest";
import { AnswerRenderer } from "../../../src/ui/modal/answer-renderer.js";

function fakeTarget() {
  const calls: string[] = [];
  return {
    target: { setMarkdown: (md: string) => calls.push(md) },
    calls,
  };
}

describe("AnswerRenderer", () => {
  it("renders accumulated chunks on flush()", () => {
    const { target, calls } = fakeTarget();
    const r = new AnswerRenderer(target, { debounceMs: 0 });
    r.append("Hello ");
    r.append("world");
    r.flush();
    expect(calls[calls.length - 1]).toBe("Hello world");
  });

  it("debounces rapid appends", () => {
    vi.useFakeTimers();
    const { target, calls } = fakeTarget();
    const r = new AnswerRenderer(target, { debounceMs: 50 });
    r.append("a");
    r.append("b");
    r.append("c");
    expect(calls.length).toBe(0);
    vi.advanceTimersByTime(60);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe("abc");
    vi.useRealTimers();
  });

  it("reset() clears accumulated text", () => {
    const { target, calls } = fakeTarget();
    const r = new AnswerRenderer(target, { debounceMs: 0 });
    r.append("first");
    r.flush();
    r.reset();
    r.append("second");
    r.flush();
    expect(calls[calls.length - 1]).toBe("second");
  });
});
