import { describe, it, expect } from "vitest";
import LlmWikiPlugin from "../../../src/plugin.js";

/**
 * Regression test for the extraction-start freeze.
 *
 * The settings tab subscribes to extraction state changes, and its listener
 * triggers a re-render which in turn **re-subscribes** a fresh listener.
 * When `setRunning` iterates the listener Set with `for..of`, any listeners
 * added during iteration are visited in the same loop — so a re-subscribing
 * listener produces an infinite loop and freezes Obsidian.
 *
 * This test emulates that pattern: a listener that unsubscribes itself and
 * subscribes a new listener on every notification. Before the fix, this hangs.
 */
describe("extraction state listener notification", () => {
  it("does not loop when a listener re-subscribes during notification", () => {
    const plugin = Object.create(LlmWikiPlugin.prototype) as unknown as {
      onExtractionStateChange: (l: () => void) => () => void;
      setRunning: (v: boolean) => void;
    };
    // Initialize only the fields the listener machinery needs.
    (plugin as unknown as { running: boolean }).running = false;
    (plugin as unknown as { extractionStateListeners: Set<() => void> }).extractionStateListeners = new Set();

    let calls = 0;
    let unsubscribe: () => void = () => {};

    const subscribe = (): void => {
      unsubscribe = plugin.onExtractionStateChange(() => {
        calls++;
        if (calls > 50) {
          throw new Error("listener notification looped (freeze bug)");
        }
        // Mimic settings-tab `display()`: unsubscribe + resubscribe.
        unsubscribe();
        subscribe();
      });
    };
    subscribe();

    expect(() => plugin.setRunning(true)).not.toThrow();
    // Exactly one notification should have fired.
    expect(calls).toBe(1);
  });
});
