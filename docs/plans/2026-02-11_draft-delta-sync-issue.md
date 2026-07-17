# Draft GitHub Issue for ynab/ynab-sdk-js

## Scratchpad / Notes

### Context

We're building an MCP server that maintains a local replica of YNAB budget data using
the `GET /budgets/{budget_id}` endpoint with `last_knowledge_of_server` for delta sync.
We've had to reverse-engineer the merge semantics through trial and error, and found
at least one significant bug in our naive approach (month categories). We want
official guidance from the YNAB team.

### Key questions we want answered:

1. When a delta response includes a month, does it contain ALL categories for that month, or only the CHANGED categories?
2. Are updated entities returned as complete objects (full replacement) or partial patches?
3. Do all entity types support `deleted: true` for deletions?
4. Is the merge algorithm literally "replace by ID, delete if deleted: true" for flat arrays?
5. Are subtransactions included independently, or only when their parent transaction changes?
6. What about entities like `currency_format`, `date_format` — are those included in deltas?

### Our experience:

- Naive approach: replace entities by ID, replace months wholesale → BROKE because delta months only contain changed categories, not all categories
- Fix: merge month categories as a nested merge step
- We now run drift detection (comparing delta+merge vs full fetch) and have found this fix resolves the issue, but we're not 100% confident there aren't other nested-array gotchas

---

## Issue Title

**Question: How should delta responses (`last_knowledge_of_server`) be merged into existing budget data?**

---

## Issue Body (below)

---

### Question: Merge semantics for delta responses from `GET /budgets/{budget_id}?last_knowledge_of_server=N`

Hi! I'm building a tool that maintains a local replica of YNAB budget data using the `GET /budgets/{budget_id}` endpoint. I fetch the full budget initially, then use `last_knowledge_of_server` for subsequent requests to get only what's changed (delta sync).

The [API docs](https://api.ynab.com) mention that delta requests return "only the entities that have changed," but I haven't been able to find documentation on **how to correctly merge the delta response back into existing data**. After some trial and error, I have specific questions.

#### Our current merge algorithm

For most entity arrays (accounts, categories, payees, transactions, etc.):

1. Index existing entities by ID
2. For each entity in the delta response:
   - If `deleted === true`: remove the entity
   - Otherwise: replace the existing entity entirely (or add if new)

For **months** (keyed by `month` string, not `id`):

1. Index existing months by their `month` field
2. For each month in the delta response:
   - If the month already exists locally: **merge the nested `categories` array** using the same ID-based merge algorithm above, then update the month's top-level fields
   - If it's a new month: add it directly

#### The bug we hit

We initially treated months the same as other entities — wholesale replacement by key. This caused data loss: when a delta response included a month, it only contained the **changed** categories for that month, not all of them. Replacing the entire month object dropped all the unchanged categories.

We caught this by running "drift detection" — periodically doing both a delta sync and a full sync, then comparing the merged result against the full result. The drift showed hundreds of missing categories across dozens of months.

After switching to a nested merge for month categories, the drift disappeared. But we're not fully confident this is the complete picture.

#### Specific questions

1. **Month categories**: Can you confirm that a delta response for a month contains **only the changed categories**, not the complete set? (This is what we've observed, and what our fix assumes.)

2. **Entity completeness**: When an entity appears in a delta response, is it a **complete object** (i.e., safe to fully replace the local copy) or a **partial patch** (only changed fields)? Our current approach is full replacement, which seems to work.

3. **Nested arrays in general**: Are there other entity types besides months that have **nested arrays requiring recursive merging**? For example:

   - Do `category_groups` in the delta include only changed groups, and if so, do the groups contain only changed categories or all their categories?
   - Are `subtransactions` returned independently in the top-level `subtransactions` array, or nested within their parent transaction, or both?

4. **Deletions**: Do all entity types use the `deleted: true` flag for deletions in delta responses? Are there any entity types that handle removal differently?

5. **Non-array fields**: How should non-array fields like `currency_format`, `date_format`, `first_month`, `last_month` be handled in delta responses? Are they always present, or only when changed?

6. **Server knowledge semantics**: If no changes occurred since the last `server_knowledge` value, does the response contain empty arrays for all entity types, or could some arrays be omitted entirely (null/undefined)?

#### Why this matters

Without clear merge semantics, anyone building on the delta sync feature has to reverse-engineer the behavior or fall back to always fetching the full budget (which is wasteful and counts against the rate limit). A brief section in the API docs or a note here would save a lot of guesswork for SDK consumers.

#### Environment

- SDK version: `ynab@2.10.0`
- Endpoint: `GET /v1/budgets/{budget_id}?last_knowledge_of_server=N`

Thanks for any clarification!
