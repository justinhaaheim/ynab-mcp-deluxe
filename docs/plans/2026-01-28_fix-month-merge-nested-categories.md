# Fix Month Merge Bug: Nested Categories Not Merged

## Issue

ynab-mcp-deluxe-sa2 (P1 Bug)

## Problem

Delta sync validation revealed that `mergeMonthArray()` is not correctly merging months. When a delta response includes months, we replace the entire month object instead of merging the nested `categories` array.

**Evidence from logs:**

- 526 differences (83 months, 443 transactions)
- All differences are `kind: "N"` (New) items in `months.X.categories[Y]`
- Categories exist in full fetch but not in merged budget

## Root Cause

In `mergeMonthArray()` (local-budget.ts:179):

```typescript
byMonth.set(month.month, month); // WRONG: replaces entire month
```

But `MonthDetail` contains:

- Scalar fields: `income`, `budgeted`, `activity`, `to_be_budgeted`, `age_of_money`, `note`, `deleted`
- **Nested array**: `categories: Array<Category>` (must be merged, not replaced!)

When YNAB returns a delta month, it may only include CHANGED categories. Our code replaces the whole month, losing all unchanged categories.

## Fix Plan

- [x] Update `mergeMonthArray()` to merge nested `categories` array
- [x] When a month exists, use `mergeEntityArray` on the categories
- [x] Add test for the category merge scenario
- [x] Run full test suite (37 tests pass)
- [x] Run `bun run signal` to check for lint/ts issues

## Implementation

When merging a month that already exists:

1. Get the existing month's categories
2. Merge delta categories using `mergeEntityArray` (handles add/update/delete)
3. Create new month with merged categories

```typescript
// Simplified logic:
if (existingMonth) {
  const mergedCategories = mergeEntityArray(
    existingMonth.categories,
    deltaMonth.categories,
  );
  byMonth.set(month.month, {...deltaMonth, categories: mergedCategories});
} else {
  byMonth.set(month.month, deltaMonth);
}
```

## Progress

- 2026-01-28: Started work on fix
- 2026-01-28: Implemented fix - mergeMonthArray now merges nested categories array
- 2026-01-28: Added 3 tests: merge scenario, deleted categories, new categories
- 2026-01-28: All tests pass, lint clean
