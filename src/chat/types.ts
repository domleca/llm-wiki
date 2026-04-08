/**
 * Chat domain types for the multi-turn query modal.
 *
 * Defines the shape of chat history persisted to chats.json — each Chat
 * containing ChatTurns representing the conversation.
 */

export interface ChatTurn {
  question: string;
  answer: string;
  /** KB source IDs surfaced for this turn — same shape as RetrievedBundle.sources[].id. */
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
  /** Folder scope the chat was started in. */
  folder: string;
  /** LLM model id used at chat creation. */
  model: string;
  turns: ChatTurn[];
}
