import type { KBData } from "./types.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyKb(): KBData {
  const today = todayIso();
  return {
    meta: { version: 1, created: today, updated: today },
    entities: {},
    concepts: {},
    connections: [],
    sources: {},
  };
}

export class KnowledgeBase {
  data: KBData;

  constructor(data?: KBData) {
    this.data = data ?? emptyKb();
  }
}
