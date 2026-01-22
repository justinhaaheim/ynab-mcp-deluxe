# Integration Tests for YNAB MCP Server

Date: 2026-01-22
Status: In Progress

## Goal

Add integration tests for YnabClient using MSW mocks, starting with read-only mode tests to verify write operations are blocked.

## Context

From the code review (`docs/plans/2026-01-22_code-review-safety.md`), the test coverage gaps include:

| Gap                | Risk Level | Description                                                |
| ------------------ | ---------- | ---------------------------------------------------------- |
| YnabClient methods | High       | No tests for `getTransactions`, `updateTransactions`, etc. |
| Read-only mode     | High       | No tests verifying write operations are blocked            |
| Error handling     | High       | No tests for API failure scenarios                         |
| Write operations   | High       | No tests for create/update/delete transactions             |

## Current Test Setup

- Vitest + MSW for mocking YNAB API
- `src/test-setup.ts` sets up MSW server
- `src/mocks/handlers.ts` has mock handlers for all YNAB endpoints
- 5 basic tests in `src/ynab-client.test.ts` verifying MSW works

## Write Operations to Test

The following methods call `assertWriteAllowed()`:

1. `updateTransactions` - "update_transactions"
2. `createTransactions` - "create_transactions"
3. `deleteTransaction` - "delete_transaction"
4. `importTransactions` - "import_transactions"
5. `updateCategoryBudget` - "update_category_budget"

## Plan

### Phase 1: Read-Only Mode Tests (this session)

- [x] Create test structure for read-only mode
- [x] Test `isReadOnlyMode()` function directly
- [x] Test `assertWriteAllowed()` function directly
- [x] Test each write operation throws when `YNAB_READ_ONLY=true`:
  - [x] `updateTransactions`
  - [x] `createTransactions`
  - [x] `deleteTransaction`
  - [x] `importTransactions`
  - [x] `updateCategoryBudget`

### Phase 2: Write Operations (future)

- Test write operations succeed when NOT in read-only mode
- Verify API is called with correct parameters
- Verify cache invalidation works

## Implementation Notes

### Testing Environment Variables

Need to set/unset `YNAB_READ_ONLY` between tests. Options:

1. Use `vi.stubEnv()` from Vitest
2. Direct `process.env` manipulation with cleanup

### File Structure

Adding tests to `src/ynab-client.test.ts` for now (co-located with source).

---

## Progress Log

### Session 1 (2026-01-22)

- Analyzed existing test setup
- Identified 5 write operations to test
- Created this plan document
- Added 13 new tests for read-only mode:
  - 5 tests for `isReadOnlyMode()` (true/false/"1"/"0"/unset)
  - 3 tests for `assertWriteAllowed()` (doesn't throw, throws, error message)
  - 5 tests for write operations blocked in read-only mode
- All 18 tests pass (5 existing + 13 new)
- `npm run signal` passes
