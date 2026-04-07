# Test Fixtures

## sample-kb.json

A hand-curated knowledge base with deliberately diverse shapes:

- **alan-watts** — high-quality entity (3 facts, 3 sources, has aliases) → passes filters
- **andrej-karpathy** — high-quality entity (2 facts, 2 sources) → passes filters
- **exact-name** — extraction artifact (blacklisted name, no facts) → fails filters
- **lonely-entity** — single fact, single source → fails filters
- **zen-buddhism** — high-quality concept (definition + sources + related) → passes filters
- **law-of-reversed-effort** — high-quality concept → passes filters
- **address-book** — blacklisted concept name with no definition → fails filters

Used by every test that needs a KB to operate on. Not auto-generated; edit by hand
when adding new shapes that test cases require.
