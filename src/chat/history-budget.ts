/**
 * Picks the newest-preserving subset of `ChatTurn[]` that fits a token budget.
 * Tokens are approximated as `ceil(chars/4)` — good enough to keep the prompt
 * under the model's context window without a real tokenizer.
 */
import type { ChatTurn } from "./types.js";

export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Approximate cost of rendering one turn as `[user] ...\n[assistant] ...\n`. */
function turnTokens(t: ChatTurn): number {
  return approximateTokens(t.question) + approximateTokens(t.answer) + 6;
}

export interface BudgetOptions {
  /** Tokens available for history (context window minus everything else). */
  availableTokens: number;
}

/** Returns the newest-preserving subset of `turns` that fits the budget. */
export function budgetHistory(
  turns: readonly ChatTurn[],
  opts: BudgetOptions,
): ChatTurn[] {
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turnTokens(turns[i]!);
    if (used + cost > opts.availableTokens) break;
    kept.unshift(turns[i]!);
    used += cost;
  }
  return kept;
}
