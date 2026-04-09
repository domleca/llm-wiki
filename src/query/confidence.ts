import type { RetrievedBundle } from "./types.js";

export type ConfidenceLevel = "confident" | "thin" | "empty";

/**
 * Assess how much relevant context the retrieval found.
 *
 * - **empty**: zero entities AND zero concepts — the KB has nothing on this topic.
 * - **thin**: some results, but very few (≤2 total items or ≤1 source file).
 * - **confident**: enough material to give a grounded answer.
 */
export function assessConfidence(bundle: RetrievedBundle): ConfidenceLevel {
  const items = bundle.entities.length + bundle.concepts.length;
  if (items === 0) return "empty";
  if (items <= 2 && bundle.sources.length <= 1) return "thin";
  return "confident";
}

const EMPTY_MESSAGES = [
  "We don't seem to have anything on that.",
  "Nothing in our notes about that one.",
  "That's a blank spot in our knowledge.",
  "We haven't covered that yet.",
  "\u00AF\\_(\u30C4)_/\u00AF nothing here.",
];

export function randomEmptyMessage(): string {
  return EMPTY_MESSAGES[Math.floor(Math.random() * EMPTY_MESSAGES.length)]!;
}
