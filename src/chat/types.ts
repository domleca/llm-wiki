export interface ChatTurn {
  question: string;
  answer: string;
  sourceIds: string[];
  /** For turn >= 2: the LLM-rewritten standalone question used for retrieval. */
  rewrittenQuery: string | null;
  createdAt: number;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  folder: string;
  model: string;
  turns: ChatTurn[];
}
