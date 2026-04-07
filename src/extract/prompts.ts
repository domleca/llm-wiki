/**
 * Extraction prompt template. Ported byte-for-byte from
 * ~/tools/llm-wiki/extract.py (EXTRACT_PROMPT) so that both the Python CLI
 * and the plugin produce identical extraction requests for the same model
 * and same vault content.
 */

export interface BuildExtractionPromptArgs {
  vocabulary: string;
  sourcePath: string;
  content: string;
}

const TEMPLATE = `You are a knowledge extraction system. Given a document and a vocabulary of already-known entities and concepts, extract structured knowledge.

RULES:
1. If an entity or concept already exists in the vocabulary, USE ITS EXACT NAME. Do not create duplicates or variants.
2. Only create a NEW entity/concept if it is clearly absent from the vocabulary.
3. Be conservative — extract only what the document actually says, not inferences.
4. All output must be in English regardless of the source language.
5. Every entity needs a type: person, org, tool, project, book, article, place, event, other.
6. Connections have a type: influences, uses, critiques, extends, part-of, created-by, related-to, applies-to, contrasts-with.

CURRENT VOCABULARY:
{vocabulary}

DOCUMENT ({source_path}):
---
{content}
---

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "source_summary": "1-2 sentence summary of what this document is about",
  "entities": [
    {
      "name": "Exact Name",
      "type": "person|org|tool|project|book|article|place|event|other",
      "aliases": ["optional", "other names"],
      "facts": ["factual statement from this document"]
    }
  ],
  "concepts": [
    {
      "name": "Concept Name",
      "definition": "Brief definition based on document content",
      "related": ["names of related concepts or entities"]
    }
  ],
  "connections": [
    {
      "from": "Entity or Concept Name",
      "to": "Entity or Concept Name",
      "type": "influences|uses|critiques|extends|part-of|created-by|related-to|applies-to|contrasts-with",
      "description": "Brief description of the relationship"
    }
  ]
}
`;

export function buildExtractionPrompt(
  args: BuildExtractionPromptArgs,
): string {
  return TEMPLATE.replace("{vocabulary}", args.vocabulary)
    .replace("{source_path}", args.sourcePath)
    .replace("{content}", args.content);
}
