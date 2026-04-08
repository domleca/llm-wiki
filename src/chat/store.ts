/**
 * Pure helpers over the Chat/ChatTurn types from ./types.js.
 * No I/O, no mutation — every function returns a fresh object.
 */

import type { Chat, ChatTurn } from "./types.js";

export interface CreateChatArgs {
  id: string;
  now: number;
  folder: string;
  model: string;
}

export function createChat(args: CreateChatArgs): Chat {
  return {
    id: args.id,
    title: "Untitled",
    createdAt: args.now,
    updatedAt: args.now,
    folder: args.folder,
    model: args.model,
    turns: [],
  };
}

export function appendTurn(chat: Chat, turn: ChatTurn, now: number): Chat {
  return { ...chat, turns: [...chat.turns, turn], updatedAt: now };
}

export function updateChatTitle(chat: Chat, title: string, now: number): Chat {
  return { ...chat, title, updatedAt: now };
}

export const renameChat = updateChatTitle;

export function deleteChat(chats: readonly Chat[], id: string): Chat[] {
  return chats.filter((c) => c.id !== id);
}

export function sortChatsByRecency(chats: readonly Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}
