# Testing Analysis and Recommendations

**Date:** 2026-01-19

---

## TL;DR

| Aspect             | Current State               | Recommendation                    |
| ------------------ | --------------------------- | --------------------------------- |
| **Test Framework** | Vitest installed but unused | Good choice, use it               |
| **Test Coverage**  | 0% - No tests exist         | Add tests incrementally           |
| **Priority Focus** | N/A                         | Helper functions → Client → Tools |

**Immediate Actions:**

1. Add unit tests for `helpers.ts` (pure functions, easy to test)
2. Add unit tests for `ynab-client.ts` with mocked YNAB API
3. Add integration tests for MCP tools

---

## 1. Current Testing State

### Infrastructure

| Component          | Status                        |
| ------------------ | ----------------------------- |
| **Test Framework** | Vitest v3.1.3 installed       |
| **Test Script**    | `bun run test` → `vitest run` |
| **Test Files**     | **None exist**                |
| **Coverage Tool**  | Not configured                |

### Observation

The project has Vitest installed and configured in `package.json`, but there are **zero test files** in the `src/` directory. The test infrastructure is ready but completely unused.

---

## 2. What Should Be Tested

### 2.1 Helper Functions (`src/helpers.ts`) - **High Priority**

These are pure functions with no dependencies - easiest to test:

| Function                          | Test Cases                                                      |
| --------------------------------- | --------------------------------------------------------------- |
| `applyJMESPath()`                 | Valid queries, invalid queries, various data structures         |
| `sortTransactions()`              | newest, oldest, amount_desc, amount_asc, empty arrays           |
| `filterByPayee()`                 | Case insensitivity, partial matches, import_payee_name fallback |
| `filterByDateRange()`             | sinceDate only, untilDate only, both, neither, edge cases       |
| `filterByAccount()`               | Matching, non-matching                                          |
| `calculateCategoryDistribution()` | Normal case, uncategorized, empty, percentage rounding          |
| `createErrorResponse()`           | Format verification                                             |
| `validateSelector()`              | Both provided (error), neither (ok), one only (ok)              |
| `isTransformed()`                 | Transformed vs raw transaction arrays                           |

### 2.2 YNAB Client (`src/ynab-client.ts`) - **High Priority**

Requires mocking the YNAB API:

| Method                   | Test Cases                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `getBudgets()`           | Success, API error, caching                                                                   |
| `resolveBudgetId()`      | By name, by ID, env var default, last-used, single budget auto-select, multiple budgets error |
| `resolveAccountId()`     | By name, by ID, not found errors                                                              |
| `resolveCategoryId()`    | By name, by ID, not found errors                                                              |
| `resolvePayeeId()`       | By name, by ID, not found returns null                                                        |
| `getTransactions()`      | Filtering, enrichment, deleted exclusion                                                      |
| `updateTransactions()`   | Success, partial failure, read-only mode block                                                |
| `createTransaction()`    | Success, cache invalidation, read-only block                                                  |
| `deleteTransaction()`    | Success, read-only block                                                                      |
| `importTransactions()`   | Success, read-only block                                                                      |
| `updateCategoryBudget()` | Success, read-only block                                                                      |
| `enrichTransaction()`    | All fields correctly enriched                                                                 |
| `toCurrency()`           | Various currency formats                                                                      |

### 2.3 Read-Only Mode - **High Priority**

Critical safety feature:

| Test Case                                                  |
| ---------------------------------------------------------- |
| `isReadOnlyMode()` returns true when `YNAB_READ_ONLY=true` |
| `isReadOnlyMode()` returns true when `YNAB_READ_ONLY=1`    |
| `isReadOnlyMode()` returns false when not set              |
| `assertWriteAllowed()` throws when read-only               |
| All write operations blocked in read-only mode             |

### 2.4 MCP Tools (`src/server.ts`) - **Medium Priority**

Integration tests for the full tool pipeline:

| Tool                         | Test Cases                                   |
| ---------------------------- | -------------------------------------------- |
| `get_budgets`                | Lists budgets correctly                      |
| `query_transactions`         | Various filters, JMESPath queries, sorting   |
| `get_payee_history`          | Category distribution calculation            |
| `get_categories`             | Groups and categories, JMESPath              |
| `get_accounts`               | Account listing, JMESPath                    |
| `update_transactions`        | Batch update, partial failure handling       |
| `get_payees`                 | Payee listing                                |
| `get_scheduled_transactions` | Scheduled transaction listing                |
| `get_months`                 | Month summaries                              |
| `get_budget_summary`         | Current month, specific month, hidden filter |
| `create_transaction`         | All parameters, selector resolution          |
| `delete_transaction`         | Success case                                 |
| `import_transactions`        | Success case                                 |
| `update_category_budget`     | Category resolution, amount setting          |

### 2.5 Error Handling - **Medium Priority**

| Scenario                            |
| ----------------------------------- |
| API rate limiting                   |
| Network errors                      |
| Invalid budget/account/category IDs |
| Malformed input data                |
| YNAB API error responses            |

---

## 3. Recommended Testing Strategy

### 3.1 Test File Organization

```
src/
├── helpers.ts
├── helpers.test.ts        # Unit tests for helper functions
├── ynab-client.ts
├── ynab-client.test.ts    # Unit tests with mocked YNAB API
├── server.ts
├── server.test.ts         # Integration tests for MCP tools
└── types.ts               # No tests needed (type definitions only)
```

### 3.2 Mock Strategy

**YNAB API Mocking:**

```typescript
import {vi} from 'vitest';
import * as ynab from 'ynab';

vi.mock('ynab');

const mockApi = {
  budgets: {
    getBudgets: vi.fn(),
  },
  accounts: {
    getAccounts: vi.fn(),
  },
  transactions: {
    getTransactions: vi.fn(),
    updateTransaction: vi.fn(),
    updateTransactions: vi.fn(),
    createTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
    importTransactions: vi.fn(),
  },
  categories: {
    getCategories: vi.fn(),
    updateMonthCategory: vi.fn(),
  },
  payees: {
    getPayees: vi.fn(),
  },
  months: {
    getBudgetMonths: vi.fn(),
    getBudgetMonth: vi.fn(),
  },
  scheduledTransactions: {
    getScheduledTransactions: vi.fn(),
  },
};

(ynab.API as any).mockImplementation(() => mockApi);
```

### 3.3 Test Data Factories

Create reusable test data:

```typescript
// src/test-utils.ts
export function createMockTransaction(overrides = {}) {
  return {
    id: 'txn-123',
    date: '2026-01-15',
    amount: -45990,
    memo: 'Test memo',
    cleared: 'cleared',
    approved: true,
    account_id: 'acct-1',
    account_name: 'Checking',
    payee_id: 'payee-1',
    payee_name: 'Amazon',
    category_id: 'cat-1',
    category_name: 'Shopping',
    category_group_id: 'grp-1',
    transfer_account_id: null,
    transfer_transaction_id: null,
    matched_transaction_id: null,
    import_id: null,
    import_payee_name: null,
    import_payee_name_original: null,
    flag_color: null,
    deleted: false,
    subtransactions: [],
    ...overrides,
  };
}

export function createMockBudget(overrides = {}) {
  return {
    id: 'budget-123',
    name: 'My Budget',
    last_modified_on: '2026-01-15T10:00:00Z',
    first_month: '2024-01-01',
    last_month: '2026-01-01',
    currency_format: {
      iso_code: 'USD',
      example_format: '$1,234.56',
      decimal_digits: 2,
      decimal_separator: '.',
      symbol_first: true,
      group_separator: ',',
      currency_symbol: '$',
      display_symbol: true,
    },
    ...overrides,
  };
}
```

---

## 4. Priority Implementation Plan

### Phase 1: Foundation (Recommended First)

1. **Create `src/helpers.test.ts`**

   - Test all pure functions
   - ~30 test cases
   - No mocking required
   - Estimated: 1-2 hours

2. **Set up test utilities**
   - Create `src/test-utils.ts` with mock factories
   - Configure Vitest for coverage reporting

### Phase 2: Core Client Tests

3. **Create `src/ynab-client.test.ts`**
   - Mock YNAB API
   - Test all client methods
   - Test read-only mode
   - ~50 test cases
   - Estimated: 2-3 hours

### Phase 3: Integration Tests

4. **Create `src/server.test.ts`**
   - Test each MCP tool
   - Test error handling
   - ~40 test cases
   - Estimated: 2-3 hours

### Phase 4: Coverage & CI

5. **Add coverage configuration**
   - Configure Vitest coverage
   - Set coverage thresholds
   - Add to CI pipeline

---

## 5. Example Test Files

### 5.1 `src/helpers.test.ts` (Starter)

```typescript
import {describe, it, expect} from 'vitest';
import {
  applyJMESPath,
  sortTransactions,
  filterByPayee,
  filterByDateRange,
  filterByAccount,
  calculateCategoryDistribution,
  createErrorResponse,
  validateSelector,
  isTransformed,
} from './helpers.js';
import type {EnrichedTransaction} from './types.js';

describe('helpers', () => {
  describe('applyJMESPath', () => {
    it('should apply a simple projection', () => {
      const data = [{id: '1', name: 'test'}];
      const result = applyJMESPath(data, '[*].name');
      expect(result).toEqual(['test']);
    });

    it('should apply a filter expression', () => {
      const data = [
        {id: '1', amount: -100},
        {id: '2', amount: -200},
      ];
      const result = applyJMESPath(data, '[?amount < `-150`]');
      expect(result).toEqual([{id: '2', amount: -200}]);
    });

    it('should throw on invalid JMESPath expression', () => {
      const data = [{id: '1'}];
      expect(() => applyJMESPath(data, '[invalid')).toThrow(/Invalid JMESPath/);
    });
  });

  describe('sortTransactions', () => {
    const transactions: EnrichedTransaction[] = [
      {
        id: '1',
        date: '2026-01-15',
        amount: -100,
        // ... other required fields
      } as EnrichedTransaction,
      {
        id: '2',
        date: '2026-01-10',
        amount: -200,
      } as EnrichedTransaction,
    ];

    it('should sort by newest first', () => {
      const sorted = sortTransactions(transactions, 'newest');
      expect(sorted[0].id).toBe('1');
    });

    it('should sort by oldest first', () => {
      const sorted = sortTransactions(transactions, 'oldest');
      expect(sorted[0].id).toBe('2');
    });

    it('should sort by amount descending (largest outflow first)', () => {
      const sorted = sortTransactions(transactions, 'amount_desc');
      expect(sorted[0].id).toBe('2'); // -200 is larger outflow
    });

    it('should sort by amount ascending (smallest outflow first)', () => {
      const sorted = sortTransactions(transactions, 'amount_asc');
      expect(sorted[0].id).toBe('1'); // -100 is smaller outflow
    });
  });

  describe('filterByPayee', () => {
    const transactions: EnrichedTransaction[] = [
      {
        id: '1',
        payee_name: 'Amazon',
        import_payee_name: null,
        import_payee_name_original: null,
      } as EnrichedTransaction,
      {
        id: '2',
        payee_name: 'Walmart',
        import_payee_name: null,
        import_payee_name_original: null,
      } as EnrichedTransaction,
      {
        id: '3',
        payee_name: null,
        import_payee_name: 'AMAZON.COM',
        import_payee_name_original: null,
      } as EnrichedTransaction,
    ];

    it('should filter by payee name case-insensitively', () => {
      const filtered = filterByPayee(transactions, 'amazon');
      expect(filtered).toHaveLength(2);
    });

    it('should search import_payee_name too', () => {
      const filtered = filterByPayee(transactions, 'AMAZON');
      expect(filtered.map((t) => t.id)).toContain('3');
    });
  });

  describe('validateSelector', () => {
    it('should not throw when selector is undefined', () => {
      expect(() => validateSelector(undefined, 'Budget')).not.toThrow();
    });

    it('should not throw when only name is provided', () => {
      expect(() => validateSelector({name: 'test'}, 'Budget')).not.toThrow();
    });

    it('should not throw when only id is provided', () => {
      expect(() => validateSelector({id: 'abc'}, 'Budget')).not.toThrow();
    });

    it('should throw when both name and id are provided', () => {
      expect(() =>
        validateSelector({name: 'test', id: 'abc'}, 'Budget'),
      ).toThrow(/must specify exactly one/);
    });
  });

  describe('createErrorResponse', () => {
    it('should return proper MCP error format', () => {
      const response = createErrorResponse('Test error');
      expect(response.isError).toBe(true);
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe('Test error');
    });
  });
});
```

### 5.2 Read-Only Mode Tests

```typescript
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {isReadOnlyMode, assertWriteAllowed} from './ynab-client.js';

describe('read-only mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isReadOnlyMode', () => {
    it('should return false when YNAB_READ_ONLY is not set', () => {
      delete process.env['YNAB_READ_ONLY'];
      expect(isReadOnlyMode()).toBe(false);
    });

    it('should return true when YNAB_READ_ONLY is "true"', () => {
      process.env['YNAB_READ_ONLY'] = 'true';
      expect(isReadOnlyMode()).toBe(true);
    });

    it('should return true when YNAB_READ_ONLY is "1"', () => {
      process.env['YNAB_READ_ONLY'] = '1';
      expect(isReadOnlyMode()).toBe(true);
    });

    it('should return false for other values', () => {
      process.env['YNAB_READ_ONLY'] = 'false';
      expect(isReadOnlyMode()).toBe(false);
    });
  });

  describe('assertWriteAllowed', () => {
    it('should not throw when read-only mode is disabled', () => {
      delete process.env['YNAB_READ_ONLY'];
      expect(() => assertWriteAllowed('test_operation')).not.toThrow();
    });

    it('should throw when read-only mode is enabled', () => {
      process.env['YNAB_READ_ONLY'] = 'true';
      expect(() => assertWriteAllowed('test_operation')).toThrow(
        /Server is in read-only mode/,
      );
    });

    it('should include operation name in error message', () => {
      process.env['YNAB_READ_ONLY'] = 'true';
      expect(() => assertWriteAllowed('update_transactions')).toThrow(
        /update_transactions/,
      );
    });
  });
});
```

---

## 6. Coverage Goals

| Phase       | Target Coverage      |
| ----------- | -------------------- |
| **Phase 1** | helpers.ts: 90%+     |
| **Phase 2** | ynab-client.ts: 80%+ |
| **Phase 3** | server.ts: 70%+      |
| **Overall** | 75%+                 |

---

## 7. Vitest Configuration Enhancement

Add coverage reporting to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

Create `vitest.config.ts`:

```typescript
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types.ts'],
      thresholds: {
        global: {
          statements: 75,
          branches: 75,
          functions: 75,
          lines: 75,
        },
      },
    },
  },
});
```

---

## Summary

The project has the test infrastructure in place but no actual tests. The recommended approach is:

1. **Start with helpers.ts** - Pure functions, no mocking, easy wins
2. **Add client tests** - Mock YNAB API, test core business logic
3. **Add tool tests** - Integration tests for MCP tools
4. **Configure coverage** - Track progress, set thresholds

This phased approach will build confidence in the codebase incrementally while maintaining development velocity.
