/**
 * Integration tests for YNAB MCP Server
 */
import {http, HttpResponse} from 'msw';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as ynab from 'ynab';

import {server} from './mocks/node.js';
import {assertWriteAllowed, isReadOnlyMode, ynabClient} from './ynab-client.js';

const YNAB_BASE_URL = 'https://api.ynab.com/v1';

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

// ============================================================================
// Selector Resolution Tests
// ============================================================================

describe('Selector Resolution', () => {
  const budgetId = 'test-budget-id';

  beforeEach(() => {
    vi.stubEnv('YNAB_ACCESS_TOKEN', 'fake-access-token');
    ynabClient.clearCaches();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Standard currency format for mocks
  const mockCurrencyFormat = {
    currency_symbol: '$',
    decimal_digits: 2,
    decimal_separator: '.',
    display_symbol: true,
    example_format: '123,456.78',
    group_separator: ',',
    iso_code: 'USD',
    symbol_first: true,
  };

  // Helper to set up a complete budget cache mock with custom data
  // getBudgetCache makes 4 parallel API calls, so we need to mock all of them
  const setupBudgetCacheMock = (options: {
    accounts?: {
      closed?: boolean;
      deleted?: boolean;
      id: string;
      name: string;
    }[];
    categories?: {
      category_group_id: string;
      deleted?: boolean;
      hidden?: boolean;
      id: string;
      name: string;
    }[];
    categoryGroups?: {
      deleted?: boolean;
      hidden?: boolean;
      id: string;
      name: string;
    }[];
    payees?: {deleted?: boolean; id: string; name: string}[];
  }) => {
    server.use(
      // Budget endpoint (for currency format)
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId`, () => {
        return HttpResponse.json({
          data: {
            budget: {
              currency_format: mockCurrencyFormat,
              id: budgetId,
              name: 'Test Budget',
            },
          },
        });
      }),
      // Accounts endpoint
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId/accounts`, () => {
        return HttpResponse.json({
          data: {
            accounts: (options.accounts ?? []).map((a) => ({
              closed: a.closed ?? false,
              deleted: a.deleted ?? false,
              id: a.id,
              name: a.name,
            })),
          },
        });
      }),
      // Categories endpoint
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId/categories`, () => {
        return HttpResponse.json({
          data: {
            category_groups: (options.categoryGroups ?? []).map((g) => ({
              categories: (options.categories ?? [])
                .filter((c) => c.category_group_id === g.id)
                .map((c) => ({
                  category_group_id: c.category_group_id,
                  deleted: c.deleted ?? false,
                  hidden: c.hidden ?? false,
                  id: c.id,
                  name: c.name,
                })),
              deleted: g.deleted ?? false,
              hidden: g.hidden ?? false,
              id: g.id,
              name: g.name,
            })),
          },
        });
      }),
      // Payees endpoint
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId/payees`, () => {
        return HttpResponse.json({
          data: {
            payees: (options.payees ?? []).map((p) => ({
              deleted: p.deleted ?? false,
              id: p.id,
              name: p.name,
            })),
          },
        });
      }),
    );
  };

  describe('resolveAccountId()', () => {
    const accountTestData = {
      accounts: [
        {id: 'acc-checking-id', name: 'Checking Account'},
        {id: 'acc-savings-id', name: 'Savings Account'},
        {closed: true, id: 'acc-closed-id', name: 'Closed Account'},
      ],
    };

    it('resolves account by exact name (case-insensitive)', async () => {
      setupBudgetCacheMock(accountTestData);
      const id = await ynabClient.resolveAccountId(budgetId, {
        name: 'checking account',
      });
      expect(id).toBe('acc-checking-id');
    });

    it('resolves account by ID', async () => {
      setupBudgetCacheMock(accountTestData);
      const id = await ynabClient.resolveAccountId(budgetId, {
        id: 'acc-savings-id',
      });
      expect(id).toBe('acc-savings-id');
    });

    it('throws when both name and id are provided', async () => {
      setupBudgetCacheMock(accountTestData);
      await expect(
        ynabClient.resolveAccountId(budgetId, {
          id: 'acc-checking-id',
          name: 'Checking Account',
        }),
      ).rejects.toThrow(
        "Account selector must specify exactly one of: 'name' or 'id'.",
      );
    });

    it('throws when neither name nor id is provided', async () => {
      setupBudgetCacheMock(accountTestData);
      await expect(ynabClient.resolveAccountId(budgetId, {})).rejects.toThrow(
        "Account selector must specify 'name' or 'id'.",
      );
    });

    it('throws when account name not found', async () => {
      setupBudgetCacheMock(accountTestData);
      await expect(
        ynabClient.resolveAccountId(budgetId, {name: 'Nonexistent Account'}),
      ).rejects.toThrow("No account found with name: 'Nonexistent Account'");
    });

    it('throws when account ID not found', async () => {
      setupBudgetCacheMock(accountTestData);
      await expect(
        ynabClient.resolveAccountId(budgetId, {id: 'nonexistent-id'}),
      ).rejects.toThrow("No account found with ID: 'nonexistent-id'");
    });
  });

  describe('resolveCategoryId()', () => {
    const categoryTestData = {
      categories: [
        {
          category_group_id: 'group-1',
          id: 'cat-groceries-id',
          name: 'Groceries',
        },
        {category_group_id: 'group-1', id: 'cat-dining-id', name: 'Dining Out'},
        {
          category_group_id: 'group-1',
          hidden: true,
          id: 'cat-hidden-id',
          name: 'Hidden Category',
        },
      ],
      categoryGroups: [{id: 'group-1', name: 'Food'}],
    };

    it('resolves category by exact name (case-insensitive)', async () => {
      setupBudgetCacheMock(categoryTestData);
      const id = await ynabClient.resolveCategoryId(budgetId, {
        name: 'groceries',
      });
      expect(id).toBe('cat-groceries-id');
    });

    it('resolves category by ID', async () => {
      setupBudgetCacheMock(categoryTestData);
      const id = await ynabClient.resolveCategoryId(budgetId, {
        id: 'cat-dining-id',
      });
      expect(id).toBe('cat-dining-id');
    });

    it('throws when both name and id are provided', async () => {
      setupBudgetCacheMock(categoryTestData);
      await expect(
        ynabClient.resolveCategoryId(budgetId, {
          id: 'cat-groceries-id',
          name: 'Groceries',
        }),
      ).rejects.toThrow(
        "Category selector must specify exactly one of: 'name' or 'id'.",
      );
    });

    it('throws when neither name nor id is provided', async () => {
      setupBudgetCacheMock(categoryTestData);
      await expect(ynabClient.resolveCategoryId(budgetId, {})).rejects.toThrow(
        "Category selector must specify 'name' or 'id'.",
      );
    });

    it('throws when category name not found', async () => {
      setupBudgetCacheMock(categoryTestData);
      await expect(
        ynabClient.resolveCategoryId(budgetId, {name: 'Nonexistent Category'}),
      ).rejects.toThrow("No category found with name: 'Nonexistent Category'");
    });
  });

  describe('resolvePayeeId()', () => {
    const payeeTestData = {
      payees: [
        {id: 'payee-amazon-id', name: 'Amazon'},
        {id: 'payee-target-id', name: 'Target'},
        {deleted: true, id: 'payee-deleted-id', name: 'Deleted Payee'},
      ],
    };

    it('resolves payee by exact name (case-insensitive)', async () => {
      setupBudgetCacheMock(payeeTestData);
      const id = await ynabClient.resolvePayeeId(budgetId, {name: 'amazon'});
      expect(id).toBe('payee-amazon-id');
    });

    it('resolves payee by ID', async () => {
      setupBudgetCacheMock(payeeTestData);
      const id = await ynabClient.resolvePayeeId(budgetId, {
        id: 'payee-target-id',
      });
      expect(id).toBe('payee-target-id');
    });

    it('returns null when neither name nor id is provided', async () => {
      setupBudgetCacheMock(payeeTestData);
      const id = await ynabClient.resolvePayeeId(budgetId, {});
      expect(id).toBeNull();
    });

    it('throws when both name and id are provided', async () => {
      setupBudgetCacheMock(payeeTestData);
      await expect(
        ynabClient.resolvePayeeId(budgetId, {
          id: 'payee-amazon-id',
          name: 'Amazon',
        }),
      ).rejects.toThrow(
        "Payee selector must specify exactly one of: 'name' or 'id'.",
      );
    });

    it('throws when payee ID not found', async () => {
      setupBudgetCacheMock(payeeTestData);
      await expect(
        ynabClient.resolvePayeeId(budgetId, {id: 'nonexistent-id'}),
      ).rejects.toThrow("No payee found with ID: 'nonexistent-id'");
    });

    it('returns null when payee name not found (allows new payee creation)', async () => {
      setupBudgetCacheMock(payeeTestData);
      const id = await ynabClient.resolvePayeeId(budgetId, {
        name: 'New Store',
      });
      expect(id).toBeNull();
    });
  });
});

// ============================================================================
// API Error Handling Tests
// ============================================================================

describe('API Error Handling', () => {
  const budgetId = 'test-budget-id';

  beforeEach(() => {
    vi.stubEnv('YNAB_ACCESS_TOKEN', 'fake-access-token');
    ynabClient.clearCaches();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws on 401 Unauthorized', async () => {
    server.use(
      http.get(`${YNAB_BASE_URL}/budgets`, () => {
        return HttpResponse.json(
          {
            error: {
              detail: 'Invalid access token',
              id: '401',
              name: 'unauthorized',
            },
          },
          {status: 401},
        );
      }),
    );

    await expect(ynabClient.getBudgets()).rejects.toThrow();
  });

  it('throws on 404 Not Found', async () => {
    server.use(
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId`, () => {
        return HttpResponse.json(
          {error: {detail: 'Budget not found', id: '404', name: 'not_found'}},
          {status: 404},
        );
      }),
    );

    await expect(ynabClient.getAccounts(budgetId)).rejects.toThrow();
  });

  it('throws on 429 Rate Limited', async () => {
    server.use(
      http.get(`${YNAB_BASE_URL}/budgets`, () => {
        return HttpResponse.json(
          {
            error: {
              detail: 'Too many requests',
              id: '429',
              name: 'too_many_requests',
            },
          },
          {status: 429},
        );
      }),
    );

    await expect(ynabClient.getBudgets()).rejects.toThrow();
  });

  it('throws on 500 Server Error', async () => {
    server.use(
      http.get(`${YNAB_BASE_URL}/budgets`, () => {
        return HttpResponse.json(
          {
            error: {
              detail: 'Internal server error',
              id: '500',
              name: 'internal_error',
            },
          },
          {status: 500},
        );
      }),
    );

    await expect(ynabClient.getBudgets()).rejects.toThrow();
  });
});

// ============================================================================
// Cache Behavior Tests
// ============================================================================

describe('Cache Behavior', () => {
  const budgetId = 'test-budget-id';
  let apiCallCount: number;

  // Standard currency format for mocks
  const mockCurrencyFormat = {
    currency_symbol: '$',
    decimal_digits: 2,
    decimal_separator: '.',
    display_symbol: true,
    example_format: '123,456.78',
    group_separator: ',',
    iso_code: 'USD',
    symbol_first: true,
  };

  // Helper to set up counting handlers for all 4 endpoints that getBudgetCache calls
  const setupCountingMock = () => {
    server.use(
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId`, () => {
        apiCallCount++;
        return HttpResponse.json({
          data: {
            budget: {
              currency_format: mockCurrencyFormat,
              id: budgetId,
              name: 'Test Budget',
            },
          },
        });
      }),
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId/accounts`, () => {
        apiCallCount++;
        return HttpResponse.json({
          data: {
            accounts: [
              {closed: false, deleted: false, id: 'acc-1', name: 'Account 1'},
            ],
          },
        });
      }),
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId/categories`, () => {
        apiCallCount++;
        return HttpResponse.json({
          data: {
            category_groups: [
              {
                categories: [
                  {
                    category_group_id: 'grp-1',
                    deleted: false,
                    hidden: false,
                    id: 'cat-1',
                    name: 'Category 1',
                  },
                ],
                deleted: false,
                hidden: false,
                id: 'grp-1',
                name: 'Group 1',
              },
            ],
          },
        });
      }),
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId/payees`, () => {
        apiCallCount++;
        return HttpResponse.json({
          data: {
            payees: [{deleted: false, id: 'payee-1', name: 'Payee 1'}],
          },
        });
      }),
    );
  };

  beforeEach(() => {
    vi.stubEnv('YNAB_ACCESS_TOKEN', 'fake-access-token');
    ynabClient.clearCaches();
    apiCallCount = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('caches budget data after first fetch', async () => {
    setupCountingMock();

    // First call - should hit the API (4 parallel calls: budget, accounts, categories, payees)
    await ynabClient.resolveAccountId(budgetId, {id: 'acc-1'});
    expect(apiCallCount).toBe(4);

    // Second call - should use cache (no additional API calls)
    await ynabClient.resolveCategoryId(budgetId, {id: 'cat-1'});
    expect(apiCallCount).toBe(4);

    // Third call - should still use cache (no additional API calls)
    await ynabClient.resolvePayeeId(budgetId, {id: 'payee-1'});
    expect(apiCallCount).toBe(4);
  });

  it('clearCaches() forces fresh API call', async () => {
    setupCountingMock();

    // First call (4 parallel API calls)
    await ynabClient.resolveAccountId(budgetId, {id: 'acc-1'});
    expect(apiCallCount).toBe(4);

    // Clear cache
    ynabClient.clearCaches();

    // Second call - should hit API again (4 more parallel API calls)
    await ynabClient.resolveAccountId(budgetId, {id: 'acc-1'});
    expect(apiCallCount).toBe(8);
  });
});
