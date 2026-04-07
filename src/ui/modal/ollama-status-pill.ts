/**
 * Pure helper for the Ollama liveness pill in the query modal.
 *
 * The pill has three logical states:
 *   - `unknown` — first render before any ping has resolved. Hidden.
 *   - `on`      — last ping returned true. Hidden (no clutter when healthy).
 *   - `off`     — last ping returned false. Visible, red, clickable.
 *
 * The decision to hide-when-on matches the user's UX request: a third pill
 * appears between model and folder ONLY when Ollama is unreachable.
 */

export type OllamaPingState = "unknown" | "on" | "off";

export function ollamaPingStateFromBool(
  reachable: boolean | null,
): OllamaPingState {
  if (reachable === null) return "unknown";
  return reachable ? "on" : "off";
}

export interface OllamaPillRender {
  visible: boolean;
  text: string;
}

export function renderOllamaPill(state: OllamaPingState): OllamaPillRender {
  if (state === "off") return { visible: true, text: "ollama: off" };
  return { visible: false, text: "" };
}
