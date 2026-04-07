/**
 * Rich-content helper for the "Ollama disconnected" Notice. The Notice
 * lists the commands a user can run to start Ollama, each in a `<code>`
 * block with a copy button so the user does not have to carefully select
 * the text. Click the button → command is copied to the clipboard.
 *
 * Split into a pure data export (testable) and a DOM-builder (not tested
 * directly — vitest is `node` env so DocumentFragment isn't available).
 */

import { setIcon } from "obsidian";

/** The commands to suggest, in display order. */
export const OLLAMA_HINT_COMMANDS: readonly string[] = [
  "brew services start ollama",
  "ollama serve",
];

export const OLLAMA_HINT_INTRO =
  "Ollama is not reachable. Relaunch with one of the commands below:";

export interface OllamaHintFragmentOptions {
  /** Document used to create elements. Pass `document` in production. */
  doc: Document;
  /** Called with the command string when the user clicks a copy button. */
  onCopy: (command: string) => void;
}

/**
 * Builds a DocumentFragment with the intro text plus one row per command,
 * each row being a `<code>` block followed by a copy button. The caller
 * is responsible for handing the fragment to `new Notice(fragment, ...)`.
 */
export function buildOllamaHintFragment(
  opts: OllamaHintFragmentOptions,
): DocumentFragment {
  const { doc, onCopy } = opts;
  const frag = doc.createDocumentFragment();

  const intro = doc.createElement("div");
  intro.textContent = OLLAMA_HINT_INTRO;
  intro.className = "llm-wiki-ollama-hint-intro";
  frag.appendChild(intro);

  for (const cmd of OLLAMA_HINT_COMMANDS) {
    const row = doc.createElement("div");
    row.className = "llm-wiki-ollama-hint-row";

    const code = doc.createElement("code");
    code.textContent = cmd;
    code.className = "llm-wiki-ollama-hint-code";
    row.appendChild(code);

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "llm-wiki-ollama-hint-copy clickable-icon";
    btn.setAttribute("aria-label", `Copy "${cmd}"`);
    btn.title = "Copy";
    setIcon(btn, "copy");
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onCopy(cmd);
      setIcon(btn, "check");
      btn.disabled = true;
      window.setTimeout(() => {
        setIcon(btn, "copy");
        btn.disabled = false;
      }, 1200);
    });
    row.appendChild(btn);

    frag.appendChild(row);
  }

  return frag;
}
