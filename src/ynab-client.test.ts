/**
 * Sample test demonstrating MSW mock integration with the YNAB client
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as ynab from 'ynab';

import {assertWriteAllowed, isReadOnlyMode, ynabClient} from './ynab-client.js';

// ============================================================================
// Read-Only Mode Tests
// ============================================================================

describe('Read-Only Mode', () => {
  beforeEach(() => {
    // Clear any cached env values
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isReadOnlyMode()', () => {
    it('returns false when YNAB_READ_ONLY is not set', () => {
      expect(isReadOnlyMode()).toBe(false);
    });

    it('returns true when YNAB_READ_ONLY is "true"', () => {
      vi.stubEnv('YNAB_READ_ONLY', 'true');
      expect(isReadOnlyMode()).toBe(true);
    });

    it('returns true when YNAB_READ_ONLY is "1"', () => {
      vi.stubEnv('YNAB_READ_ONLY', '1');
      expect(isReadOnlyMode()).toBe(true);
    });

    it('returns false when YNAB_READ_ONLY is "false"', () => {
      vi.stubEnv('YNAB_READ_ONLY', 'false');
      expect(isReadOnlyMode()).toBe(false);
    });

    it('returns false when YNAB_READ_ONLY is "0"', () => {
      vi.stubEnv('YNAB_READ_ONLY', '0');
      expect(isReadOnlyMode()).toBe(false);
    });
  });

  describe('assertWriteAllowed()', () => {
    it('does not throw when read-only mode is disabled', () => {
      vi.stubEnv('YNAB_READ_ONLY', 'false');
      expect(() => assertWriteAllowed('test_operation')).not.toThrow();
    });

    it('throws when read-only mode is enabled', () => {
      vi.stubEnv('YNAB_READ_ONLY', 'true');
      expect(() => assertWriteAllowed('test_operation')).toThrow(
        'Write operation "test_operation" blocked: Server is in read-only mode.',
      );
    });

    it('includes guidance on how to enable writes in error message', () => {
      vi.stubEnv('YNAB_READ_ONLY', 'true');
      expect(() => assertWriteAllowed('test_operation')).toThrow(
        'Set YNAB_READ_ONLY=false to enable writes.',
      );
    });
  });

  describe('Write operations blocked in read-only mode', () => {
    const budgetId = 'test-budget-id';

    beforeEach(() => {
      vi.stubEnv('YNAB_READ_ONLY', 'true');
    });

    it('updateTransactions throws in read-only mode', async () => {
      await expect(
        ynabClient.updateTransactions(budgetId, [
          {category_id: 'cat-1', id: 'txn-1'},
        ]),
      ).rejects.toThrow(
        'Write operation "update_transactions" blocked: Server is in read-only mode.',
      );
    });

    it('createTransactions throws in read-only mode', async () => {
      await expect(
        ynabClient.createTransactions(budgetId, [
          {
            account_id: 'acc-1',
            amount: -10000,
            date: '2026-01-22',
          },
        ]),
      ).rejects.toThrow(
        'Write operation "create_transactions" blocked: Server is in read-only mode.',
      );
    });

    it('deleteTransaction throws in read-only mode', async () => {
      await expect(
        ynabClient.deleteTransaction(budgetId, 'txn-1'),
      ).rejects.toThrow(
        'Write operation "delete_transaction" blocked: Server is in read-only mode.',
      );
    });

    it('importTransactions throws in read-only mode', async () => {
      await expect(ynabClient.importTransactions(budgetId)).rejects.toThrow(
        'Write operation "import_transactions" blocked: Server is in read-only mode.',
      );
    });

    it('updateCategoryBudget throws in read-only mode', async () => {
      await expect(
        ynabClient.updateCategoryBudget(budgetId, '2026-01-01', 'cat-1', 50000),
      ).rejects.toThrow(
        'Write operation "update_category_budget" blocked: Server is in read-only mode.',
      );
    });
  });

  describe('Write operations succeed when not in read-only mode', () => {
    const budgetId = 'test-budget-id';

    beforeEach(() => {
      // Ensure read-only mode is disabled
      vi.stubEnv('YNAB_READ_ONLY', 'false');
      // Provide a fake access token for the YNAB API client
      vi.stubEnv('YNAB_ACCESS_TOKEN', 'fake-access-token');
      // Clear any cached state from previous tests
      ynabClient.clearCaches();
    });

    it('updateTransactions returns updated transactions', async () => {
      const result = await ynabClient.updateTransactions(budgetId, [
        {category_id: 'cat-1', id: 'txn-1'},
      ]);

      expect(result).toBeDefined();
      expect(result.updated).toBeDefined();
      expect(Array.isArray(result.updated)).toBe(true);
    });

    it('createTransactions returns created transactions and duplicates', async () => {
      const result = await ynabClient.createTransactions(budgetId, [
        {
          account_id: 'acc-1',
          amount: -10000,
          date: '2026-01-22',
        },
      ]);

      expect(result).toBeDefined();
      expect(result.created).toBeDefined();
      expect(Array.isArray(result.created)).toBe(true);
      expect(result.duplicates).toBeDefined();
      expect(Array.isArray(result.duplicates)).toBe(true);
    });

    it('deleteTransaction returns deleted transaction', async () => {
      const result = await ynabClient.deleteTransaction(budgetId, 'txn-1');

      expect(result).toBeDefined();
      expect(result.deleted).toBeDefined();
      expect(result.deleted.id).toBeDefined();
    });

    it('importTransactions returns import count and transaction IDs', async () => {
      const result = await ynabClient.importTransactions(budgetId);

      expect(result).toBeDefined();
      expect(typeof result.imported_count).toBe('number');
      expect(result.transaction_ids).toBeDefined();
      expect(Array.isArray(result.transaction_ids)).toBe(true);
    });

    it('updateCategoryBudget returns enriched category', async () => {
      const result = await ynabClient.updateCategoryBudget(
        budgetId,
        '2026-01-01',
        'cat-1',
        50000,
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBeDefined();
      expect(typeof result.budgeted).toBe('number');
      expect(result.budgeted_currency).toBeDefined();
    });
  });
});

// ============================================================================
// MSW Mock Integration Tests
// ============================================================================

describe('YNAB API Mocking', () => {
  it('should intercept API calls and return mocked data', async () => {
    // Create a YNAB API client pointing to the mocked base URL
    const api = new ynab.API('fake-access-token');

    // This call will be intercepted by MSW and return faker-generated data
    const response = await api.budgets.getBudgets();

    // Verify we got a response with the expected structure
    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.budgets).toBeDefined();
    expect(Array.isArray(response.data.budgets)).toBe(true);
  });

  it('should return mocked budget details', async () => {
    const api = new ynab.API('fake-access-token');

    // Use a fake budget ID - MSW will intercept and return mocked data
    const response = await api.budgets.getBudgetById('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.budget).toBeDefined();
  });

  it('should return mocked accounts', async () => {
    const api = new ynab.API('fake-access-token');

    const response = await api.accounts.getAccounts('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.accounts).toBeDefined();
    expect(Array.isArray(response.data.accounts)).toBe(true);
  });

  it('should return mocked categories', async () => {
    const api = new ynab.API('fake-access-token');

    const response = await api.categories.getCategories('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.category_groups).toBeDefined();
    expect(Array.isArray(response.data.category_groups)).toBe(true);
  });

  it('should return mocked transactions', async () => {
    const api = new ynab.API('fake-access-token');

    const response = await api.transactions.getTransactions('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.transactions).toBeDefined();
    expect(Array.isArray(response.data.transactions)).toBe(true);
  });
});
