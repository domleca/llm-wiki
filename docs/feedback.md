# User Feedback

This file tracks feedback from users of LLM Wiki — what they asked for, what they
hit, and what we decided to do about it. It is manually curated: every edit is
reviewed by the maintainer before it lands.

**Sources we monitor**

- Reddit launch thread: [r/ObsidianMD](https://www.reddit.com/r/ObsidianMD/comments/1shntdn/new_plugin_llm_wiki_turn_your_vault_into_a/)
- GitHub issues: [domleca/llm-wiki](https://github.com/domleca/llm-wiki/issues)
- Obsidian forum: [thread](https://forum.obsidian.md/t/new-plugin-llm-wiki-turn-your-vault-into-a-queryable-knowledge-base-privately/113223)
- Twitter/X: [launch post](https://x.com/domleca/status/2042613694278799728)
- Direct messages

_Last updated: 2026-04-11_

**Status legend**

- 🟢 Shipped — in the codebase, validated
- 🟡 Partial — some of the ask is covered, some isn't
- 🔵 Planned — on the roadmap, not yet started
- ⚪ Considering — not yet decided
- 🔴 Declined — explicitly not doing, with reason given
- 📌 Principle — not a feature, a constraint on product direction

---

## Themes

Themes are grouped by underlying need and ranked by (a) number of distinct users
who raised it and (b) severity of the friction. Each theme shows **how many
users** asked for it — that's the primary signal.

---

### 1. Support OpenAI-compatible endpoints (LM Studio, KoboldCpp, OpenRouter, …)

**6 users** — cprz, x31n10n, sergykal, Bulleta, EmberGlitch, hudsondir
**Status:** 🟢 Shipped
**Severity:** High — hard blocker for anyone not already on Ollama.

**What they want.** Point the plugin at any OpenAI-compatible inference server,
not just Ollama. Users named specific tools they already run: LM Studio, Osaurus,
KoboldCpp, OpenRouter, Mistral, Kimi, Deepseek, and "whatever I have loaded
locally."

**The cleanest framing came from EmberGlitch:**

> "please just allow configuring custom OpenAI API compatible endpoints. That
> should be a lot easier to implement and maintain than having hardcoded presets
> for every possible API provider. Notable ones missing right now are, for
> example, OpenRouter, Mistral, Kimi and Deepseek just off the top of my head.
> That should also cover KoboldCpp and pretty much any other local inference
> tools people might want to use."

**Why it matters.** Ollama isn't the default on every user's machine. cprz put
it plainly: *"to test this plugin I'd need install another local server and more
local models."* That's an immediate bounce. Supporting the OpenAI REST shape is
the single highest-leverage change on this list.

**Adjacent discoverability issue (not a bug).** Two users (cprz, x31n10n) thought
the plugin *forced* them into the two default models with no way to choose
others. A third user (conductordudedallas) eventually discovered that clicking
the model label in the Ask console lets you pick any installed Ollama model.
The setting exists; it isn't findable. Obsidian's UI surface is tight, but a
more obvious model picker in preferences would prevent this misread.

**What shipped.** PR #6 added a custom `openai-compatible` provider with a base
URL, API key, model, and per-endpoint overrides for models, completions, and
embeddings. That covers LM Studio, KoboldCpp, OpenRouter, self-hosted proxies,
and other OpenAI-shaped backends without needing provider-by-provider presets.

---

### 2. Let users skip folders from extraction, not just from queries

**1 user** — neo451 ([GitHub #3](https://github.com/domleca/llm-wiki/issues/3))
**Status:** 🟢 Shipped
**Severity:** Medium — wasted compute on junk folders, hits vaults with lots of
dailies/templates/media the hardest.

**What they wanted.** Restrict the plugin to specific folders (e.g. `Projects/`
+ `Zettel/`) and skip everything else: dailies, templates, media databases.
Three possible shapes suggested: (1) folder allowlist, (2) gitignore-style
ignore list, (3) tag-based filter.

**What shipped.** PR #4 added multi-folder query scope, and PR #5 extended that
same `queryFolders` setting into extraction and the on-save watcher. Extraction
now respects the chosen folder scope instead of always walking the whole vault.

**Resolution.** neo451's underlying complaint is now addressed: users can limit
both extraction and querying to the folders they actually care about.

---

### 3. Extract from PDFs, not just markdown

**2 users** — houska1, EmberGlitch (concurring with a tool suggestion)
**Status:** ⚪ Considering
**Severity:** Medium — a big slice of real vaults contain PDFs as primary sources
(papers, reports, clipped docs). Skipping them misses real knowledge.

**What they want.** houska1 confirmed LLM Wiki only ingests `.md` files today
and asked for PDF ingestion. They suggested three routes:

1. Trawl Omnisearch / Text Extractor's existing cache.
2. Piggyback on Text Extractor's API to query its output for PDFs referenced in
   `.md` files.
3. Homebrew text extraction with something like `pdfplumber` in the ingest flow.

EmberGlitch replied pointing at Microsoft's
[markitdown](https://github.com/microsoft/markitdown) as a ready-made option —
it handles PDFs, DOCX, PPTX and more, and is actively maintained.

**Proposed action**
- Evaluate `markitdown` as the ingest preprocessor for non-markdown files.
- Track as a v2.0 candidate, not a v1 blocker.

---

### 4. Configurable output language

**1 user** — ContextFull8268
**Status:** 🟢 Shipped
**Severity:** Low effort, high satisfaction.

**What they said.**

> "as i had to edit the main.js manually to change the output language, i would
> recommend making this available as an option in the settings."

Non-English users are hitting "answers come back in English even though my
notes are in French" — and are willing to hand-patch the compiled plugin to
fix it. A settings toggle would turn that from a wart into a one-minute
configuration.

**What shipped.** PR #7 added an `Extraction language` setting. By default it
uses the user's configured Obsidian app language automatically, and users can
also override it explicitly with a small set of common languages (English,
French, Spanish, German, Italian, Dutch, Portuguese).

**Resolution.** Users no longer need to patch `main.js` just to stop extracted
summaries, facts, and definitions from being forced into English.

---

### 5. Conversation → vault notes

**1 user (validated, already planned)** — conductordudedallas
**Status:** 🔵 Planned (already on the post-V1 roadmap)

**What they said.**

> "I did a query for information about creating a second brain — and it def
> returned some great stuff. How do I then add that to the wiki as a source?
> Perhaps I'm misunderstanding. Currently, I just copied and pasted the result
> into a new note, and the LLM indexed it. Just assumed there was a way that
> this happens automatically?"

**Why this matters.** This feature was already on our internal roadmap. What
changes with this comment is that a real user is doing the copy-paste workaround
right now — so this isn't a guess, it's a confirmed gap. Worth moving up.

**Proposed action**
- Ship "save answer as note" action in the query modal.
- Optionally: offer to add the saved note as a source on the next extraction run.

---

### 6. Rename the `Wiki/` folder (collision with existing workflows)

**1 user** — conductordudedallas
**Status:** ⚪ Considering
**Severity:** Low effort, avoids onboarding friction for the Karpathy-method
crowd who already have a `Wiki/` folder.

**What they said.**

> "I'm already using the Karpathy method on other topics through Claude — which
> created a folder also called Wiki. Can I change the name of this Wiki or will
> that mess things up?"

**Proposed action**
- Add a setting to rename or prefix the generated folder (e.g. `LLM Wiki/`).
- Default shouldn't change, but the option unblocks the overlap.

---

### 7. Extraction progress visibility

**1 user (self-resolved)** — conductordudedallas
**Status:** 🟢 Shipped, but discoverability is weak.

**What happened.** The user said *"I see extraction running, but no indication
of time or progress?"* and then, a few minutes later: *"Oh wait — I see the
status bar now."* The status bar exists and shows progress. They just didn't
spot it for a while.

**Proposed action (optional, low priority)**
- On first extraction run, consider a one-time prominent indicator (notice,
  modal, or toast) pointing at the status bar. The `welcome modal on first
  load` already exists — a line about "watch the status bar for progress"
  could live there.

---

### 8. Pull in non-vault data sources (browser history, bookmarks, autofill)

**1 user** — Deep_Ad1959
**Status:** ⚪ Considering

**What they said.**

> "the entity extraction approach is solid but the real gap in most setups like
> this is that your notes are only a fraction of what you actually know. your
> browser autofill has contacts and addresses, your history has interests and
> patterns, your bookmarks are a curated knowledge graph you forgot about. if
> you could pull all of that into the same sqlite index alongside your vault,
> the retrieval quality jumps significantly because you have actual structured
> identity data backing up the fuzzy note references."

**Why it's interesting.** The insight is real: vault notes under-represent what
a user actually knows. Browser history alone is a richer identity signal than
most KBs.

**Why it's hard.** Conflicts with the "local, private, under your control"
stance unless there's a clean opt-in flow per data source. Also cross-platform:
browser histories live in different databases on Chrome/Firefox/Safari and are
locked in different ways.

**Proposed action**
- Keep on the radar, not near-term. Worth revisiting if a clean opt-in pattern
  emerges or if a single user group (e.g. academic researchers with Zotero)
  becomes a focus.

---

### 9. Mobile / phone support

**1 user (wishful)** — Stroxtile
**Status:** 🔴 Declined (for now)

**What they said.**

> "Unfortunately idk if my phone can run something like this but on desktops
> this is really good!"

**Why decline.** Running a local LLM on a phone is impractical with current
on-device inference. Revisit if small local models become viable on mobile or
if a trusted remote-inference mode is added.

---

## Related / competing projects users mentioned

Worth watching, not urgent.

- [`atomicmemory/llm-wiki-compiler`](https://github.com/atomicmemory/llm-wiki-compiler)
  — a terminal-based tool built on the same Karpathy LLM-Wiki idea, mentioned
  by knlgeth. Worth a look for prior-art and design comparison.
- **Khoj** — mentioned by Jahbino as what they're using instead, pending
  hardware fixes.
- **cowork** (Obsidian plugin) — mentioned by supervrai as a point of comparison.
- **Omnisearch + Text Extractor + AI Image Analyzer** — houska1's analogy for
  the ingestion pipeline; worth reviewing how they chain extraction.
- **Microsoft [markitdown](https://github.com/microsoft/markitdown)** —
  EmberGlitch's recommendation for PDF ingestion.

---

## Raw sources (traceability)

Only substantive, action-bearing comments/issues are preserved below. Generic
praise ("great work!", "saving this for later") has been collapsed. The
maintainer's own replies (`atenreign2` on Reddit) are excluded from feedback
counts.

### GitHub — domleca/llm-wiki

| # | Title | Author | State | Theme | Resolution |
|---|-------|--------|-------|-------|------------|
| #2 | Failed to load | @AJThurston | Closed | → README | Clarified by @StefKors in the issue. Explicit manual-install instructions added to the README in commit `d98ba83`. Moot after community store acceptance. |
| #3 | configurable multi folder index / ignore folders | @neo451 | Closed by PR #5 | #2 | 🟢 Shipped — query and extraction scope now both respect selected folders |

### Reddit — r/ObsidianMD launch thread

_46 comments total, fetched 2026-04-11. Shown here: substantive feedback only._

| Author | Score | Theme | Quote (trimmed for length) |
|--------|-------|-------|------|
| cprz | +1 | #1 | "Seems cool but limiting it to ollama and apparently those two models is unnecessary. [...] allowing user to set the address for the OpenAI option would be a lot as those apps has OpenAI compatible api. [...] to test this plugin I'd need install another local server and more local models." |
| cprz (reply) | +1 | #1 | "The plugin doesn't show any options to select the models for me at least. I'm not using Ollama at all. [...] your plugin tries to access /api/tags which neither of those apps support. [...] Also the embed model you recommend seems to be english only." |
| x31n10n | +1 | #1 | "This looks good! But does it only work with these two models? Or am I able to use whichever local model I have?" |
| sergykal | +2 | #1 | "Can't find LLM wiki in community plugins. Also, can LM Studio be used instead of Ollama?" |
| Bulleta | +1 | #1 | "My computer runs better with KoboldCpp because I run models on my local network. Is there a way for me to use that instead of Ollama?" |
| EmberGlitch (reply to Bulleta) | +2 | #1 | "please just allow configuring custom OpenAI API compatible endpoints. [...] Notable ones missing right now are, for example, OpenRouter, Mistral, Kimi and Deepseek just off the top of my head. That should also cover KoboldCpp and pretty much any other local inference tools." |
| hudsondir | +0 | #1 | "Is the new local Google Gemma 4 model available as an option yet?" |
| houska1 | +3 | #3 | "Double checking: at this time, LLM Wiki only extracts from .md files, right? [...] future expansion in the same vein as Omnisearch -> Text Extractor -> AI Image Analyzer would be fantastic." |
| houska1 (reply) | +2 | #3 | "LLM Wiki v2.0 could do one of the following, for text-containing pdfs as a starting point: 1. Also trawl Omnisearch/Text Extractor's cache [...]. 2. Piggyback on Text Extractor directly to query its output for pdf attachments [...]. 3. Homebrew text extraction from pdf attachments via something like pdfplumber as part of its ingestion flow." |
| EmberGlitch (reply to houska1) | +5 | #3 | "No need to homebrew — there are plenty of tools that already do that. I've had pretty good experiences with markitdown (mostly used this to ingest pdfs for a RAG pipeline at work). https://github.com/microsoft/markitdown" |
| ContextFull8268 | +1 | #4 | "as i had to edit the main.js manually to change the output language, i would recommend making this available as an option in the settings." |
| conductordudedallas (q1) | +0 | #7 | "I show extraction running, but no indication of time, or progress? How long should this last with a rather medium-sized vault?" |
| conductordudedallas (q1 follow-up) | +3 | #7 | "Oh wait - I see the status bar now." |
| conductordudedallas (q2) | +0 | #5, #6 | "I did a query for information about creating a second brain [...]. How do I then add that to the wiki as a source? [...] Currently, I just copied and pasted the result into a new note. [...] I'm already using the Karpathy method on other topics through Claude - which created a folder also called Wiki. Can I change the name of this Wiki or will that mess things up?" |
| Deep_Ad1959 | +1 | #8 | "the entity extraction approach is solid but the real gap [...] your notes are only a fraction of what you actually know. your browser autofill has contacts and addresses, your history has interests and patterns, your bookmarks are a curated knowledge graph you forgot about. if you could pull all of that into the same sqlite index alongside your vault, the retrieval quality jumps significantly." |
| Stroxtile | +36 | #9 | "Compared to all the other AI stuff. This is actually helpful. [...] Unfortunately idk if my phone can run something like this but on desktops this is really good!" |
| dollythemushroom | +3 | → README | 3-bucket Karpathy framing (Raw / Wiki / Output). Incorporated into the README in commit `d98ba83` under "Your notes, the wiki, and your chats". |
| knlgeth | +2 | (related project) | "We've actually made a similar format in terminal based of Karpathy's idea of LLM Knowledge Bases. Give it a spin and let me know what you think: https://github.com/atomicmemory/llm-wiki-compiler" |
| Jahbino | +1 | (context) | "Been wanting to do this myself, ran into some hardware issues when tinkering with ollama install on my Mac and abandoned the idea for the time being. Just been using Khoj and other LLM plugin for now." |

### Obsidian forum

_No substantive feedback extracted yet. Thread: https://forum.obsidian.md/t/new-plugin-llm-wiki-turn-your-vault-into-a-queryable-knowledge-base-privately/113223_

### Twitter/X

_No substantive feedback extracted yet. Post: https://x.com/domleca/status/2042613694278799728_
