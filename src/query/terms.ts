const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "at", "for", "with", "by", "from", "about",
  "as", "into", "through", "during", "and", "or", "but", "if", "then",
  "what", "who", "which", "where", "when", "why", "how",
  "this", "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
  "do", "does", "did", "have", "has", "had", "can", "could", "should", "would",
  "will", "shall", "may", "might", "must", "me", "my", "your", "his", "her",
  "its", "our", "their",
]);

export function extractQueryTerms(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
