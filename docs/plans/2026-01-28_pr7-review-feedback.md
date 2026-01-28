# PR7 Review Feedback Implementation

## Beads

- `ynab-cir` - Issue 1: Derive types from YNAB SDK enums
- `ynab-qus` - Issue 2: Add tests for enrichTransactionSummary + read methods
- `ynab-l6n` - Issue 3: Fix possible dead code in SubTransaction payee_name
- `ynab-nqm` - Issue 4: Add subtransaction lookup maps for O(1) joins
- `ynab-3y4` - Issue 5: Extract repeated enrichment logic into helpers
- `ynab-6o8` - Issue 6: Improve error messages for deleted vs not-found

## Findings from Investigation

### Issue 3 - NOT dead code

The YNAB SDK `SubTransaction` interface **does** include `payee_name` and `category_name` as optional fields. So the code checking `sub.payee_name` is valid. However, the full budget endpoint (`/budgets/:id`) returns `TransactionSummary` which may NOT populate these fields (they're populated on the individual transaction endpoints). The code correctly falls back to lookup by ID, so the current logic is defensive and correct. I'll add a clarifying comment.

### TransactionFlagColor has an empty string value

`TransactionFlagColor` includes `""` (empty string) in addition to the 6 colors. Need to handle this in the Zod schema - the empty string likely maps to "no flag" in the API. In Zod enum for create/update we want only the 6 colors (+ null for clearing), but in types we should match the SDK.

## Work Order

1. **Issue 5** (extract helpers) - Do this first since it refactors the enrichment code that other issues touch
2. **Issue 1** (SDK types) - Foundation type work, builds on the extracted helpers
3. **Issue 4** (lookup maps) - Performance improvement to enrichment
4. **Issue 3** (dead code) - Quick clarification/simplification
5. **Issue 6** (error messages) - Small targeted change
6. **Issue 2** (tests) - Last, since tests should exercise the final refactored code

## Progress

- [ ] Issue 5 - Extract enrichment helpers
- [ ] Issue 1 - Derive types from SDK enums
- [ ] Issue 4 - Subtransaction lookup maps
- [ ] Issue 3 - Clarify SubTransaction.payee_name handling
- [ ] Issue 6 - Deleted vs not-found error messages
- [ ] Issue 2 - Tests
