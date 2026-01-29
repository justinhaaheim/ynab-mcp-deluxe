# Code Review Fixes - 2026-01-29

## Overview

Addressing code review items for PR7 (delta sync / drift detection).

## Items to Address (in order)

### 1. Item 2: Race Condition in Drift Check State

**Location:** `src/drift-detection.ts:50-59`
**Issue:** Module-level `driftCheckState` is shared across all budgets
**Fix:** Move state into YnabClient so each budget tracks independently

### 2. Item 5: Missing Error Handling for subtransaction merge

**Location:** `src/local-budget.ts:69-95`
**Issue:** No guard for null/undefined `transaction_id` in subtransaction merging
**Fix:** Add guard to skip subtransactions with invalid transaction_id

### 3. Item 8: Security - Path Traversal

**Location:** `src/sync-history.ts:43-44`
**Issue:** `budgetId` in `getSyncHistoryDir()` could allow path traversal
**Fix:** Validate budgetId contains only UUID-safe characters

### 4. Item 6: Month Merge Tests

**Location:** `src/local-budget.ts:165-196`
**Issue:** Need tests for partial category updates within months
**Fix:** Add tests specifically for partial category updates

### 5. Item 3: Type Safety in Diff Handling (last)

**Location:** `src/drift-detection.ts:350-378`
**Issue:** Unsafe type assertions in diff handling
**Fix:** Create type guards for each diff kind

## Progress

- [x] Item 2: Race condition fix - Per-budget drift check state via Map
- [x] Item 5: Error handling fix - Guard for null/undefined transaction_id
- [x] Item 8: Security fix - Validate budgetId format for path safety
- [x] Item 6: Month merge tests - Already comprehensive tests exist
- [x] Item 3: Type guards - Added isDiffNew, isDiffDeleted, isDiffEdit, isDiffArray
