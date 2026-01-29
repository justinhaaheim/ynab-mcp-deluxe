# Code Review: claude/code-review-91tzn Branch

**Date:** 2026-01-29
**Branch:** `claude/code-review-91tzn`
**Commits reviewed:** ~30 commits from recent development

---

## Executive Summary

This branch contains significant work on the local budget sync system, drift detection, and logging infrastructure. The code is well-structured, follows the project's architectural principles, and has comprehensive test coverage (140 tests passing).

**One critical issue** needs to be fixed: ESLint error in `logger.ts` (use-before-define).

---

## Files Changed

### New Files

- `src/drift-snapshot.ts` - Drift artifact collection for debugging
- `src/logger.ts` - Pino-based logging with file rotation
- `scripts/install-gh-cli.sh` - GitHub CLI installation script
- `docs/plans/2026-01-28_*.md` - Scratchpad documents for various work

### Modified Files (Core)

- `src/ynab-client.ts` - Main client with sync logic
- `src/types.ts` - SDK-derived type definitions
- `src/local-budget.ts` - LocalBudget building and delta merge
- `src/drift-detection.ts` - Drift detection and logging
- `src/server.ts` - MCP server tools
- `src/*.test.ts` - Test files

---

## Issues Found

### 🚨 CRITICAL: Lint Error (Must Fix)

**File:** `src/logger.ts:100-101`
**Error:** `'fileLogger' was used before it was defined`

```typescript
// Line 100-101 in createCombinedLogger():
if (contextLog === fileLogger) {  // ❌ fileLogger not yet defined
  return fileLogger;               // ❌ fileLogger not yet defined
}

// Line 128:
export const fileLogger: ContextLog = { ... };  // Defined here
```

**Fix:** Move `fileLogger` definition above `createCombinedLogger()`, or restructure the code.

---

## Architecture Review

### ✅ Strengths

#### 1. SDK-Derived Types (Follows CLAUDE.md Guidelines)

The types.ts properly derives types from the YNAB SDK:

```typescript
export type ClearedStatus = TransactionClearedStatus;
export type FlagColor = TransactionFlagColor;
export type FlagColorInput = Exclude<TransactionFlagColor, ''>;
```

This addresses the technical debt mentioned in CLAUDE.md about hardcoded string literals.

#### 2. Drift Collection Mode Strategy

The sync strategy is clever and pragmatic:

- Always fetch full budget (guaranteed correct)
- Also fetch delta for drift comparison when conditions allow
- Save drift snapshots for later analysis
- Return the full budget as source of truth

This allows development to continue while passively collecting real-world drift data.

#### 3. O(1) Lookup Maps

The LocalBudget structure provides efficient lookups:

```typescript
interface LocalBudget {
  accountById: Map<string, Account>;
  accountByName: Map<string, Account>;
  categoryById: Map<string, Category>;
  subtransactionsByTransactionId: Map<string, SubTransaction[]>;
  scheduledSubtransactionsByScheduledTransactionId: Map<
    string,
    ScheduledSubTransaction[]
  >;
  // ...
}
```

#### 4. Enrichment Helpers

The `resolvePayeeName()` and `resolveCategoryInfo()` helpers are well-documented, explaining why they check for existing names:

```typescript
// Why we check for existing names (not dead code):
// - FULL BUDGET endpoint returns TransactionSummary which may NOT populate name fields
// - INDIVIDUAL transaction endpoints DO populate these name fields
// - We defensively check for existing names first, then fall back to ID lookup
```

#### 5. Comprehensive Testing

- 140 tests passing
- Good coverage of edge cases
- Tests for drift detection, local budget merge, read-only mode, selector resolution

#### 6. Logging Infrastructure

Pino-based logging with:

- File rotation (daily, 7 days retention)
- Combined logger (context + file)
- Configurable log level via environment variable

### 📋 Observations

#### 1. Month Merge Bug Fix

The `mergeMonthArray()` function properly handles nested categories:

```typescript
// IMPORTANT: MonthDetail contains a nested `categories` array that must be
// merged separately. Delta responses may only include CHANGED categories,
// so we must merge them with existing categories rather than replacing.
```

This is a critical fix - without it, delta syncs could lose unchanged category data.

#### 2. Error Messages for Deleted Entities

Good distinction between "not found" and "deleted":

```typescript
if (transaction.deleted === true) {
  throw new Error(`Transaction '${transactionId}' has been deleted in YNAB.`);
}
// vs
throw new Error(`Transaction not found with ID: '${transactionId}'.`);
```

#### 3. Environment Variable Configuration

Well-documented env vars with sensible defaults:

- `YNAB_DRIFT_DETECTION` (default: true)
- `YNAB_ALWAYS_FULL_SYNC` (default: false)
- `YNAB_DRIFT_CHECK_INTERVAL_SYNCS` (default: 1)
- `YNAB_DRIFT_SAMPLE_RATE` (default: 1)

---

## Test Results

```
✓ src/local-budget.test.ts (37 tests) 21ms
✓ src/drift-detection.test.ts (41 tests) 33ms
✓ src/ynab-client.test.ts (62 tests) 311ms

Test Files  3 passed (3)
Tests       140 passed (140)
```

---

## Quality Checks

| Check      | Status                                           |
| ---------- | ------------------------------------------------ |
| TypeScript | ✅ Pass                                          |
| ESLint     | ❌ **2 errors** (use-before-define in logger.ts) |
| Prettier   | ✅ Pass                                          |
| Tests      | ✅ 140/140 Pass                                  |

---

## Recommendations

### Must Fix (Before Merge)

1. **Fix lint error in `logger.ts`** - Reorder code so `fileLogger` is defined before `createCombinedLogger()`

### Nice to Have (Future)

1. Consider adding integration tests that use real API mocks to validate full sync flow
2. The drift snapshot directory could use cleanup logic to prevent unbounded growth
3. Consider documenting the drift collection data format in case manual analysis is needed

---

## Conclusion

This branch represents solid work on a complex sync system. The architecture is sound, tests are comprehensive, and the code follows project guidelines. The one lint error is easily fixable.

**Recommendation:** Fix the `logger.ts` lint error, then this branch is ready for merge.
