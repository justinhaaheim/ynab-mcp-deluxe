# Code Review: Safety and Correctness

Date: 2026-01-22
Reviewer: Claude Opus 4.5

## Executive Summary

This review examined the YNAB MCP Server codebase with emphasis on safety, correctness, and data integrity risks. The codebase is well-architected with good patterns (singleton client, caching, data enrichment), but several issues were identified that could cause problems with production data.

**Tests pass:** ✅ 5 basic MSW integration tests
**TypeScript:** ✅ Clean compilation
**Lint:** ✅ No errors

---

## CRITICAL ISSUES

### 1. ~~Mock Handler Bug - PATCH /transactions Returns Empty Array~~ ✅ FIXED

**File:** `src/mocks/handlers.ts:302-309`

**Status:** FIXED - Added `getUpdateTransactions200Response()` function and updated handler.

~~**Impact:** The bulk transaction update endpoint has an EMPTY `resultArray`. When this endpoint is called, it would cause runtime errors.~~

---

## HIGH PRIORITY (Safety/Data Risk)

### 2. ~~Cache Invalidation Race Condition in updateTransactions~~ ✅ FIXED

**File:** `src/ynab-client.ts:515-638`

**Status:** FIXED - Cache is now always invalidated after write operations, and fresh cache is fetched before enriching transactions in the fallback path.

**Changes made:**

- Removed conditional cache invalidation (was only for `payee_name`)
- Now always invalidates and re-fetches cache after any update
- In fallback path, stores raw transactions first, then enriches after getting fresh cache

### 3. ~~Silent Error Swallowing~~ ✅ FIXED

**File:** `src/ynab-client.ts:580-587`

**Status:** FIXED - Original bulk update error is now logged with `console.warn()` before falling back to individual updates.

```typescript
} catch (bulkError) {
  const bulkErrorMessage =
    bulkError instanceof Error ? bulkError.message : 'Unknown error';
  console.warn(
    `Bulk transaction update failed (${bulkErrorMessage}), falling back to individual updates`,
  );
```

### 4. Cross-Budget Operation Risk with lastUsedBudgetId

**File:** `src/ynab-client.ts:86, 154-156`

**Issue:** The `lastUsedBudgetId` is used when no budget selector is provided. If a user:

1. Queries Budget A (lastUsedBudgetId = A)
2. Queries Budget B with explicit selector (lastUsedBudgetId = B)
3. Updates transactions without selector → silently targets Budget B

**Risk:** Users might accidentally modify the wrong budget if they're working with multiple budgets and forget to specify which one.

**Recommendation:** Consider warning when using `lastUsedBudgetId` for write operations, or require explicit budget selection for writes.

---

## MEDIUM PRIORITY (Bugs/Inconsistencies)

### 5. Division by Zero Not Explicitly Guarded

**File:** `src/helpers.ts:143`

```typescript
const total = transactions.length;
// ... later ...
percentage: Math.round((count / total) * 1000) / 10,
```

**Issue:** While functionally safe (empty transactions = empty counts = no division), this relies on implicit code structure. Future refactoring could introduce bugs.

**Recommendation:** Add explicit guard: `total === 0 ? 0 : (count / total) * ...`

### 6. Inconsistent Selector Validation

**File:** `src/helpers.ts:169-183` vs `src/ynab-client.ts:402-413`

`validateSelector` in helpers.ts throws only when BOTH name AND id are present, but not when NEITHER is present. The client code handles the "neither" case separately.

**Risk:** A developer might call only `validateSelector` thinking it does full validation, missing the "neither" case.

### 7. Type Safety Gap in Server Execute Handlers

**File:** `src/server.ts` (lines 167, 332, 433, etc.)

All execute handlers use `async (args) => { ... }` without explicit typing. While Zod inference works, this creates implicit `any` types visible in the TypeScript output.

**Risk:** Schema changes could silently break property access.

### 8. Mock Data Contains Random Deleted Items

**File:** `src/mocks/handlers.ts` throughout

```typescript
deleted: faker.datatype.boolean(),
```

**Issue:** Mock data randomly marks items as `deleted: true`, which then get filtered out by the client. This makes test data unpredictable.

**Recommendation:** Set `deleted: false` for primary mock data, or seed faker consistently (already seeded with 1, but still random).

### 9. Account Name Collision Handling

**File:** `src/ynab-client.ts:234-236`

```typescript
for (const account of accounts) {
  accountById.set(account.id, account);
  accountByName.set(account.name.toLowerCase(), account); // Overwrites!
}
```

**Issue:** If two accounts have the same name (different case), only one will be stored in `accountByName`.

**Recommendation:** Consider throwing an error for duplicate names or using first-match semantics explicitly.

### 10. createErrorResponse Type Inconsistency

**File:** `src/helpers.ts:156-164` vs `src/server.ts` execute handlers

`createErrorResponse` returns `{content: [...], isError: true}` but most execute handlers return `JSON.stringify(...)` on success.

**Issue:** The return type contract is inconsistent between success and error cases.

---

## LOW PRIORITY (Code Quality)

### 11. Unused Helper Function

**File:** `src/helpers.ts:189-196`

`isTransformed()` is defined but never used anywhere in the codebase.

### 12. Unused Type Definition

**File:** `src/types.ts:321-339`

`JournalEntry` interface is defined for change tracking but never used.

### 13. No Date Format Validation

**Files:** `src/server.ts` (date parameters), `src/ynab-client.ts`

Dates are accepted as strings without validation that they're in YYYY-MM-DD format.

### 14. Public clearCaches() Method

**File:** `src/ynab-client.ts:1017-1022`

`clearCaches()` is public but could be accidentally called in production, causing performance issues.

---

## TEST COVERAGE GAPS

### Currently Tested (5 tests)

- MSW intercepts API calls
- Budget retrieval returns expected structure
- Account endpoint returns expected structure
- Category endpoint returns expected structure
- Transaction endpoint returns expected structure

### NOT Tested (Critical Gaps)

| Gap                  | Risk Level | Description                                                |
| -------------------- | ---------- | ---------------------------------------------------------- |
| YnabClient methods   | High       | No tests for `getTransactions`, `updateTransactions`, etc. |
| Error handling       | High       | No tests for API failure scenarios                         |
| Cache behavior       | High       | No tests for cache invalidation, staleness                 |
| Selector resolution  | Medium     | No tests for account/category/payee by name                |
| Read-only mode       | High       | No tests verifying write operations are blocked            |
| Date filtering       | Medium     | No tests for `filterByDateRange`                           |
| JMESPath queries     | Medium     | No tests for query parsing/execution                       |
| MCP tool handlers    | High       | No integration tests for server tools                      |
| Write operations     | High       | No tests for create/update/delete transactions             |
| Bulk update fallback | High       | No tests for individual update fallback path               |

---

## Mock System Verification

### Status: PARTIALLY FUNCTIONAL

**Working:**

- GET endpoints return faker-generated data
- MSW intercepts all YNAB API calls
- Seeded faker (seed=1) provides consistent data

**Broken:**

- PATCH /budgets/:budgetId/transactions (empty resultArray)

**Not Verified:**

- Consistency between mock data and real YNAB API responses
- Category/account ID relationships in mock data (all random UUIDs)

---

## Recommendations

### Immediate (Before Production)

1. **Fix PATCH transactions mock handler** - Add proper response generation
2. **Add read-only mode tests** - Verify `assertWriteAllowed` blocks correctly
3. **Add explicit budget validation for writes** - Warn or require explicit budget for write operations

### Short-term

4. **Add YnabClient unit tests** - Test enrichment, caching, selector resolution
5. **Add error handling tests** - Test API failure scenarios and error messages
6. **Fix cache invalidation logic** - Invalidate on any mutation, not just payee_name

### Long-term

7. **Add integration tests for MCP tools** - Test full request/response cycle
8. **Improve mock data consistency** - Ensure IDs reference each other properly
9. **Add input validation** - Validate date formats, amount ranges, etc.
10. **Consider audit logging** - Implement JournalEntry for change tracking

---

## Files Reviewed

| File                    | Lines | Status   |
| ----------------------- | ----- | -------- |
| src/server.ts           | 1337  | Reviewed |
| src/ynab-client.ts      | 1026  | Reviewed |
| src/types.ts            | 339   | Reviewed |
| src/helpers.ts          | 196   | Reviewed |
| src/ynab-client.test.ts | 65    | Reviewed |
| src/test-setup.ts       | 24    | Reviewed |
| src/mocks/handlers.ts   | 2559  | Reviewed |
| src/mocks/node.ts       | 4     | Reviewed |

---

## SaveTransactionsResponseData Analysis

The YNAB API returns `SaveTransactionsResponseData` for both `createTransaction` and `updateTransactions`:

```typescript
interface SaveTransactionsResponseData {
  transaction_ids: Array<string>; // IDs that were saved
  transaction?: TransactionDetail; // Single transaction result
  transactions?: Array<TransactionDetail>; // Multiple transaction results
  duplicate_import_ids?: Array<string>; // Import IDs that were skipped as duplicates
  server_knowledge: number; // For delta sync
}
```

### Current vs Recommended Return Values

| Method               | Currently Returns                                | Issues                                                                         | Recommendation                                                                        |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `updateTransactions` | `{ failed: [], updated: EnrichedTransaction[] }` | `failed` is always empty (misleading)                                          | Remove `failed`, keep `updated`                                                       |
| `createTransaction`  | `EnrichedTransaction`                            | Doesn't surface `duplicate_import_ids`; throws misleading error for duplicates | Return `{ transaction, was_duplicate?: boolean }` or handle duplicate case explicitly |

### Key Issue: Duplicate Import ID Handling

When creating a transaction with an `import_id` that already exists on the same account:

1. The YNAB API returns success
2. `transaction` is `undefined`
3. `duplicate_import_ids` contains the skipped ID

Our current `createTransaction` code throws:

> "Failed to create transaction: no transaction returned"

This is misleading. The transaction wasn't created because it was a **duplicate**, not because of a failure. The LLM should be told it was a duplicate so it can adjust its behavior.

### Recommended Changes

1. **`updateTransactions`**: Remove the misleading `failed` field

   ```typescript
   // Before
   return {failed: [], updated: enriched};

   // After
   return {updated: enriched};
   ```

2. **`createTransaction`**: Handle duplicates explicitly

   ```typescript
   const createdTransaction = response.data.transaction;
   const duplicates = response.data.duplicate_import_ids ?? [];

   if (createdTransaction === undefined) {
     if (duplicates.length > 0) {
       throw new Error(
         `Transaction not created: import_id "${duplicates[0]}" already exists on this account`,
       );
     }
     throw new Error('Failed to create transaction: no transaction returned');
   }
   ```

3. ~~**Optional enhancement**: Return duplicate info instead of throwing~~ (Decided to throw with clear error message instead)

### Implementation Status: ✅ COMPLETE

**Changes made:**

1. Removed `failed` field from `UpdateTransactionsResult` type and `updateTransactions` return value
2. Added explicit `duplicate_import_ids` check in `createTransaction` - now throws a clear error message when a transaction is skipped due to duplicate import_id

---

## Next Audit Items

### 1. API Response Data Audit (All Tools)

Review each MCP tool to ensure we're making smart, thoughtful choices about what data to pass back to the LLM:

| Tool                         | Status      | Notes                              |
| ---------------------------- | ----------- | ---------------------------------- |
| `get_budgets`                | Pending     |                                    |
| `get_accounts`               | Pending     |                                    |
| `get_categories`             | Pending     |                                    |
| `get_payees`                 | Pending     |                                    |
| `get_transactions`           | Pending     |                                    |
| `get_transaction`            | Pending     |                                    |
| `create_transaction`         | ✅ Reviewed | Added duplicate_import_id handling |
| `update_transactions`        | ✅ Reviewed | Removed misleading `failed` field  |
| `delete_transaction`         | Pending     |                                    |
| `import_transactions`        | Pending     |                                    |
| `get_scheduled_transactions` | Pending     |                                    |
| `get_budget_month`           | Pending     |                                    |
| `get_budget_months`          | Pending     |                                    |
| `update_category_budget`     | Pending     |                                    |

### 2. Error Handling Audit

Understand the full error handling flow:

- What happens when YNAB API returns an error?
- How do we communicate errors back to the LLM?
- Are error messages clear and actionable?
- Are we surfacing the right level of detail?

Questions to answer:

1. What error types does the YNAB SDK throw?
2. How does `createErrorResponse` format errors for MCP?
3. Are there cases where we silently swallow errors?
4. Do error messages help the LLM understand what went wrong?

---

## Changelog

- 2026-01-22: Removed `failed` field from `updateTransactions` return (was always empty)
- 2026-01-22: Added explicit duplicate import_id handling in `createTransaction`
- 2026-01-22: Initial code review completed
