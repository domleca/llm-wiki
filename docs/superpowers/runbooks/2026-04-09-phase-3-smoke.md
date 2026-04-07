# Phase 3 Manual Smoke Checklist

Run against the test vault `/Users/dominiqueleca/tools/llm-wiki-test-vault` after `npm run build` and reloading Obsidian.

- [ ] Cmd+Shift+K opens the query modal with focused input
- [ ] Ribbon icon (search) opens the same modal
- [ ] Typing a question and pressing Enter starts streaming an answer
- [ ] Sources collapsible shows the correct count and expands to a list
- [ ] Esc cancels an in-flight query and closes the modal
- [ ] Up/Down arrows cycle through recent questions
- [ ] Settings tab shows the new Query section
- [ ] Changing default folder restricts subsequent queries
- [ ] `.obsidian/plugins/llm-wiki/interactions/YYYY-MM-DD.jsonl` gains a new line per query
- [ ] `.obsidian/plugins/llm-wiki/recent-questions.json` updates after each query
- [ ] First query rebuilds the embedding cache; subsequent queries reuse it
- [ ] Asking "who is exact name" returns no results (blacklist working)
- [ ] Asking a question with no matches shows a graceful "I don't know" answer
