export interface BuildAskPromptArgs {
  question: string;
  context: string;
}

const RULES = [
  "Use ONLY information present in the knowledge base context below. Do not invent facts.",
  "If the context does not contain enough to answer, say so plainly — do not speculate.",
  "When the user asks a list question (\"what books\", \"how many\"), be comprehensive: list every matching item from the context.",
  "Prefer the entity's own facts over connection summaries when both are available.",
  "Do not include raw file paths in your prose answer. Sources are tracked separately.",
  "Quote facts exactly when accuracy matters; paraphrase when synthesizing.",
  "If two facts contradict, surface the contradiction rather than picking one.",
  "Be concise. Aim for the shortest answer that fully addresses the question.",
];

export function buildAskPrompt(args: BuildAskPromptArgs): string {
  const rulesBlock = RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
  return [
    "You answer questions using a personal knowledge base.",
    "",
    "Rules:",
    rulesBlock,
    "",
    "Knowledge base context:",
    args.context,
    "",
    `Question: ${args.question}`,
    "",
    "Answer:",
  ].join("\n");
}
