# Delta Sync Investigation

## Goal

Empirically determine exactly how YNAB delta responses work, validate our merge logic, and build confidence to switch from always-full-sync to delta-first sync.

## What We Know

1. `server_knowledge` is a monotonically increasing integer returned with every budget response
2. Delta request: pass `last_knowledge_of_server=N` → get only entities changed since knowledge N
3. `deleted: boolean` is a required field on all entity types; `deleted: true` only appears in delta responses
4. Response shape is identical — full and delta both return `BudgetDetail` + `server_knowledge`
5. Our merge logic (`mergeEntityArray`): upsert by ID, delete if `deleted: true`
6. `mergeMonthArray`: special handling — months keyed by `month` string, nested categories merged

## Open Questions (What We Need to Test)

1. Does merged == full, exactly, for each entity type?
2. MonthDetail nested categories: full month or only changed categories?
3. Subtransaction handling: independent or bundled with parent?
4. Monthly category budget/activity/balance values in delta?
5. Multiple changes between syncs: final state or intermediates?
6. Deletion cascades: if txn deleted, do subtransactions get `deleted: true` too?
7. Field-level updates: complete entity replacement or partial?
8. Order stability across full/delta responses?

## Reversibility

- Transactions: full CRUD → fully reversible
- Scheduled transactions: full CRUD → fully reversible
- Category budgets: update → restore original → reversible
- Accounts: CREATE only, no DELETE → NOT reversible (skipped)
- Categories: no CREATE/DELETE API → can't test (skipped)

## Test Matrix

| #   | Test Name                    | Mutation                         | Validates                          |
| --- | ---------------------------- | -------------------------------- | ---------------------------------- |
| 1   | create_transaction           | Create a simple transaction      | Entity addition in delta           |
| 2   | update_transaction           | Edit transaction amount          | Full entity replacement vs partial |
| 3   | delete_transaction           | Delete the transaction           | `deleted: true` handling           |
| 4   | create_split_transaction     | Create txn with subtransactions  | Subtransaction creation in delta   |
| 5   | update_subtransaction        | Edit subtransaction memo         | Subtransaction independence        |
| 6   | delete_split_transaction     | Delete the split txn             | Subtransaction cascade behavior    |
| 7   | change_category_budget       | Set budget amount for a category | Monthly category changes in delta  |
| 8   | move_money                   | Change two category budgets      | Multiple changes in one month      |
| 9   | create_scheduled_transaction | Create scheduled txn             | Scheduled transaction addition     |
| 10  | delete_scheduled_transaction | Delete scheduled txn             | Scheduled transaction deletion     |
| 11  | compound_changes             | Create 2 txns + budget change    | Multi-entity-type delta            |
| 12  | noop_delta                   | No changes, just fetch           | Empty delta response               |

## Approach

Script: `scripts/delta-sync-investigation.ts`

For each test:

1. Record current `serverKnowledge` from previous full fetch
2. Make mutation(s) via YNAB API
3. Fetch delta with previous `serverKnowledge`
4. Merge delta into previous state using our `mergeDelta()`
5. Fetch full budget (no knowledge param)
6. Deep-compare merged vs full
7. Save artifacts to output directory
8. Cleanup (reverse the mutation)
9. Full fetch to reset for next test

Artifacts saved per test:

- `delta-response.json` — raw delta BudgetDetail
- `merged-budget.json` — result of mergeDelta()
- `full-response.json` — fresh full fetch (truth)
- `comparison.json` — diff results
- `delta-arrays-summary.json` — which arrays had entries and how many

## Results — 2026-03-15

**11/12 PASS, 0 FAIL, 0 WARN, 1 ERROR**

The ERROR is a YNAB SDK bug, not a merge logic bug.

### Answers to Open Questions

#### 1. Does merged == full, exactly?

**YES.** For all 11 successful tests, `mergeDelta()` produced an identical result to a fresh full fetch. Zero drift detected across transactions, accounts, categories, months, payees, scheduled transactions, subtransactions.

#### 2. MonthDetail nested categories: full month or only changed categories?

**Only changed categories.** Delta months contain only the categories that changed. Our `mergeMonthArray()` correctly merges these into existing months. Confirmed by tests 7 and 8.

#### 3. Subtransaction handling: independent or bundled with parent?

**Independent.** Subtransactions appear in their own `subtransactions` array in the delta, separate from the parent transaction. Test 4 showed `{"transactions":1,"subtransactions":2}` — 1 parent + 2 subs. Test 5 (updating parent memo only) still returned both subtransactions in the delta even though they didn't change.

#### 4. Monthly category budget/activity/balance values in delta?

**Yes, fully included.** Category changes in the delta include all fields (budgeted, activity, balance, etc.). The complete category object is returned, not partial fields. Confirmed by tests 7 and 8.

#### 5. Multiple changes between syncs: final state or intermediates?

**Final state only.** The delta returns only the final state of each changed entity. Test 8 made 2 sequential budget changes (knowledge jumped from 101→105), and the delta contained only the final values for both categories. Test 11 (compound: 2 txns + budget change) also showed only final state.

#### 6. Deletion cascades

**YES, cascades are explicit.** After patching the SDK null categories bug, test 6 passed:

- Deleting a split transaction produces `deleted: true` on the parent transaction AND on all subtransactions
- Delta contained: `{"transactions":1,"subtransactions":2}` — 1 deleted parent + 2 deleted subs
- The month entries in the delta had `categories: null` (which our patch normalizes to `[]`)
- Merge result matched full fetch exactly — zero drift

#### 7. Field-level updates: complete entity replacement or partial?

**Complete replacement.** The delta returns the full entity object with all fields. For example, updating only a transaction's amount (test 2) returned the complete transaction object with all fields populated. This confirms our merge approach of `byId.set(entity.id, entity)` is correct.

#### 8. Order stability

**Not tested directly**, but irrelevant — our merge logic uses `Map<id, entity>` so order doesn't matter. The drift detection sorts by ID before comparison, confirming order-independent correctness.

### Critical Bug Found: YNAB SDK MonthDetail deserialization

**File:** `node_modules/ynab/dist/models/MonthDetail.js` line 51
**Bug:** `json['categories'].map(CategoryFromJSON)` crashes with `null is not an object` when `categories` is `null`
**When it happens:** Delta responses where a `MonthDetail` is included but has no category-level changes (e.g., after deleting a transaction). The API returns `categories: null` instead of `categories: []`.
**Impact:** Any delta that includes months without category changes will crash the SDK.
**Workaround needed:** Patch or intercept the response to convert `null` categories to `[]` before the SDK deserializes it.

### Interesting Observations

- **serverKnowledge increments by 2** for each mutation (not 1). This may be an internal YNAB implementation detail.
- **Cascading changes in delta**: Creating a transaction causes changes in `accounts` (balance updated), `categories` (activity/balance updated), `months` (2 months affected — both current and the month of the txn), and `transactions`.
- **No-op delta**: When no changes occurred, the delta returns completely empty arrays and the same serverKnowledge value. Our merge handles this correctly.
- **Split transaction parent update** (test 5): Even though only the parent memo changed, the delta included both subtransactions. This suggests the API returns all subtransactions of a modified parent, even if the subs themselves didn't change.

### Delta Array Patterns

| Mutation                   | Arrays in delta                                                            |
| -------------------------- | -------------------------------------------------------------------------- |
| Create transaction         | accounts(1), categories(1), months(2), transactions(1)                     |
| Update transaction         | accounts(1), categories(1), months(2), transactions(1)                     |
| Delete transaction         | accounts(1), categories(1), months(2), transactions(1)                     |
| Create split txn           | accounts(1), categories(2), months(2), transactions(1), subtransactions(2) |
| Update split parent        | transactions(1), subtransactions(2)                                        |
| Change category budget     | categories(1), months(2)                                                   |
| Move money (2 cats)        | categories(2), months(2)                                                   |
| Create scheduled txn       | months(1), scheduled_transactions(1)                                       |
| Delete scheduled txn       | months(1), scheduled_transactions(1)                                       |
| Compound (2 txns + budget) | accounts(1), categories(2), months(2), transactions(2)                     |
| No-op                      | (empty)                                                                    |

## Progress

- 2026-03-15: Started. Writing investigation script.
- 2026-03-15: Ran all 12 tests. 11 PASS, 1 ERROR (SDK bug). Merge logic is correct.
- 2026-03-15: Documented findings. Key blocker for delta-first sync: YNAB SDK crashes on null categories in MonthDetail during delta deserialization.
- 2026-03-15: Patched fetch-interceptor.ts to normalize null categories to []. Test 6 now passes. All 12 tests PASS. Deletion cascades confirmed.
- 2026-03-15: **Conclusion: Delta-first sync is safe to enable.** Merge logic is correct for all tested scenarios. Only prerequisite was the SDK workaround patch (now in place).
