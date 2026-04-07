import { describe, it, expectTypeOf } from "vitest";
import type { LLMProvider, EmbedOptions } from "../../src/llm/provider.js";

describe("LLMProvider type surface", () => {
  it("declares embed(opts: EmbedOptions): Promise<number[]>", () => {
    expectTypeOf<LLMProvider>().toHaveProperty("embed");
    expectTypeOf<LLMProvider["embed"]>()
      .parameter(0)
      .toMatchTypeOf<EmbedOptions>();
    expectTypeOf<LLMProvider["embed"]>()
      .returns.toMatchTypeOf<Promise<number[]>>();
  });
});
