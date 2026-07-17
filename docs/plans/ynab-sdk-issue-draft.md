# Draft GitHub issue for ynab/ynab-sdk-js

## Title

MonthDetail deserialization crashes on null categories in delta responses; SDK lacks delta merge utilities

## Body

### Bug: `MonthDetailFromJSONTyped` crashes on null `categories`

`MonthDetailFromJSONTyped` in `dist/models/MonthDetail.js` crashes when `categories` is `null`:

```javascript
// Line 51 — crashes with "null is not an object (evaluating 'json.categories.map')"
'categories': (json['categories'].map(Category_1.CategoryFromJSON)),
```

**When it happens:** The YNAB API returns `categories: null` in delta responses (requests with `last_knowledge_of_server`) when a `MonthDetail` is included but no individual categories within that month changed. For example, deleting a transaction affects the month's `activity` and `to_be_budgeted`, so the month appears in the delta — but `categories` is `null` instead of `[]`.

**How to reproduce:**

1. Fetch a full budget and save `server_knowledge`
2. Create a split transaction, then fetch full again to get new `server_knowledge`
3. Delete the split transaction
4. Fetch delta using the `server_knowledge` from step 2
5. SDK crashes during deserialization

**Fix:** Add a null guard before `.map()`:

```javascript
// MonthDetailFromJSONTyped
'categories': (json['categories'] == null ? [] : json['categories'].map(Category_1.CategoryFromJSON)),

// MonthDetailToJSONTyped (same pattern)
'categories': (value['categories'] == null ? [] : value['categories'].map(Category_1.CategoryToJSON)),
```

Since this code is auto-generated from the OpenAPI spec, the root fix is likely updating the spec to mark `categories` as nullable, or adding a null guard in the generator template.

### Feature suggestion: Delta merge utilities

The SDK provides `last_knowledge_of_server` support for delta requests and marks entities with `deleted: true`, but provides no utilities for actually applying a delta response to a previous budget state. Every consumer has to independently implement:

- **Entity merging** — upsert by ID, remove entities with `deleted: true`
- **MonthDetail merging** — months are keyed by `month` string (not `id`), and their nested `categories` arrays need separate merging (delta months may contain only changed categories, not all categories)
- **server_knowledge tracking** — storing and updating the knowledge value across syncs

A `mergeDelta(previousBudget, deltaResponse)` utility in the SDK would prevent each consumer from having to reverse-engineer the delta semantics independently. We've empirically validated the merge logic with 12 controlled tests against a live budget (create/update/delete transactions, splits, scheduled transactions, category budgets, compound changes), so happy to share our implementation if it helps.

### Environment

- `ynab` SDK version: 2.10.0
- Runtime: Bun 1.3.8 (also reproduces in Node.js)
