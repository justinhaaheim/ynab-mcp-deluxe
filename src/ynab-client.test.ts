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

    it('createAccount throws in read-only mode', async () => {
      await expect(
        ynabClient.createAccount(budgetId, 'New Checking', 'checking', 100000),
      ).rejects.toThrow(
        'Write operation "create_account" blocked: Server is in read-only mode.',
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
      ynabClient.clearLocalBudgets();
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

    it('createAccount returns enriched account', async () => {
      const result = await ynabClient.createAccount(
        budgetId,
        'New Checking',
        'checking',
        500000,
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
      expect(result.name).toBeDefined();
      expect(typeof result.name).toBe('string');
      expect(typeof result.balance).toBe('number');
      expect(typeof result.balance_currency).toBe('number');
      expect(typeof result.cleared_balance).toBe('number');
      expect(typeof result.uncleared_balance).toBe('number');
      expect(typeof result.on_budget).toBe('boolean');
      expect(typeof result.closed).toBe('boolean');
      // Verify the type is one of the valid YNAB account types (derived from SDK)
      const validAccountTypes = Object.values(ynab.AccountType);
      expect(validAccountTypes).toContain(result.type);
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
    ynabClient.clearLocalBudgets();
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

  // Helper to set up a complete budget mock with custom data
  // The new LocalBudget system uses the full budget endpoint
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
      // Full budget endpoint (used by LocalBudget system)
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId`, () => {
        return HttpResponse.json({
          data: {
            budget: {
              accounts: (options.accounts ?? []).map((a) => ({
                closed: a.closed ?? false,
                deleted: a.deleted ?? false,
                id: a.id,
                name: a.name,
              })),
              categories: (options.categories ?? []).map((c) => ({
                category_group_id: c.category_group_id,
                deleted: c.deleted ?? false,
                hidden: c.hidden ?? false,
                id: c.id,
                name: c.name,
              })),
              category_groups: (options.categoryGroups ?? []).map((g) => ({
                deleted: g.deleted ?? false,
                hidden: g.hidden ?? false,
                id: g.id,
                name: g.name,
              })),
              currency_format: mockCurrencyFormat,
              id: budgetId,
              months: [],
              name: 'Test Budget',
              payee_locations: [],
              payees: (options.payees ?? []).map((p) => ({
                deleted: p.deleted ?? false,
                id: p.id,
                name: p.name,
              })),
              scheduled_subtransactions: [],
              scheduled_transactions: [],
              subtransactions: [],
              transactions: [],
            },
            server_knowledge: 1,
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
    ynabClient.clearLocalBudgets();
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

  // Helper to set up counting handlers for the full budget endpoint
  // The new LocalBudget system uses a single call to GET /budgets/{id}
  const setupCountingMock = () => {
    server.use(
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId`, () => {
        apiCallCount++;
        return HttpResponse.json({
          data: {
            budget: {
              accounts: [
                {closed: false, deleted: false, id: 'acc-1', name: 'Account 1'},
              ],
              categories: [
                {
                  category_group_id: 'grp-1',
                  deleted: false,
                  hidden: false,
                  id: 'cat-1',
                  name: 'Category 1',
                },
              ],
              category_groups: [
                {
                  deleted: false,
                  hidden: false,
                  id: 'grp-1',
                  name: 'Group 1',
                },
              ],
              currency_format: mockCurrencyFormat,
              id: budgetId,
              months: [],
              name: 'Test Budget',
              payee_locations: [],
              payees: [{deleted: false, id: 'payee-1', name: 'Payee 1'}],
              scheduled_subtransactions: [],
              scheduled_transactions: [],
              subtransactions: [],
              transactions: [],
            },
            server_knowledge: 1,
          },
        });
      }),
    );
  };

  beforeEach(() => {
    vi.stubEnv('YNAB_ACCESS_TOKEN', 'fake-access-token');
    ynabClient.clearLocalBudgets();
    apiCallCount = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('caches budget data after first fetch', async () => {
    setupCountingMock();

    // First call - should hit the API (1 call to full budget endpoint)
    await ynabClient.resolveAccountId(budgetId, {id: 'acc-1'});
    expect(apiCallCount).toBe(1);

    // Second call - should use local budget (no additional API calls)
    await ynabClient.resolveCategoryId(budgetId, {id: 'cat-1'});
    expect(apiCallCount).toBe(1);

    // Third call - should still use local budget (no additional API calls)
    await ynabClient.resolvePayeeId(budgetId, {id: 'payee-1'});
    expect(apiCallCount).toBe(1);
  });

  it('clearLocalBudgets() forces fresh API call', async () => {
    setupCountingMock();

    // First call (1 API call to full budget endpoint)
    await ynabClient.resolveAccountId(budgetId, {id: 'acc-1'});
    expect(apiCallCount).toBe(1);

    // Clear local budgets
    ynabClient.clearLocalBudgets();

    // Second call - should hit API again (1 more API call)
    await ynabClient.resolveAccountId(budgetId, {id: 'acc-1'});
    expect(apiCallCount).toBe(2);
  });
});

// ============================================================================
// Read Method and Enrichment Tests
// ============================================================================

describe('Read Methods and Transaction Enrichment', () => {
  const budgetId = 'test-budget-id';

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

  // Helper to set up mock budget data
  const setupMockBudget = (overrides: Record<string, unknown> = {}) => {
    server.use(
      http.get(`${YNAB_BASE_URL}/budgets/:budgetId`, () => {
        return HttpResponse.json({
          data: {
            budget: {
              accounts: [
                {
                  balance: 100000,
                  cleared_balance: 90000,
                  closed: false,
                  deleted: false,
                  id: 'acc-checking',
                  name: 'Checking',
                  on_budget: true,
                  type: 'checking',
                  uncleared_balance: 10000,
                },
              ],
              categories: [
                {
                  activity: -50000,
                  balance: 150000,
                  budgeted: 200000,
                  category_group_id: 'grp-bills',
                  deleted: false,
                  hidden: false,
                  id: 'cat-groceries',
                  name: 'Groceries',
                },
              ],
              category_groups: [
                {
                  deleted: false,
                  hidden: false,
                  id: 'grp-bills',
                  name: 'Bills',
                },
              ],
              currency_format: mockCurrencyFormat,
              id: budgetId,
              months: [
                {
                  activity: -100000,
                  age_of_money: 30,
                  budgeted: 500000,
                  categories: [
                    {
                      activity: -50000,
                      balance: 150000,
                      budgeted: 200000,
                      category_group_id: 'grp-bills',
                      deleted: false,
                      hidden: false,
                      id: 'cat-groceries',
                      name: 'Groceries',
                    },
                  ],
                  deleted: false,
                  income: 300000,
                  month: '2026-01-01',
                  note: null,
                  to_be_budgeted: 100000,
                },
                {
                  activity: 0,
                  age_of_money: null,
                  budgeted: 0,
                  categories: [],
                  deleted: true,
                  income: 0,
                  month: '2025-12-01',
                  note: null,
                  to_be_budgeted: 0,
                },
              ],
              name: 'Test Budget',
              payee_locations: [],
              payees: [
                {deleted: false, id: 'payee-store', name: 'Grocery Store'},
              ],
              scheduled_subtransactions: [],
              scheduled_transactions: [
                {
                  account_id: 'acc-checking',
                  amount: -75000,
                  category_id: 'cat-groceries',
                  date_first: '2026-01-15',
                  date_next: '2026-02-15',
                  deleted: false,
                  flag_color: null,
                  frequency: 'monthly',
                  id: 'sched-1',
                  memo: 'Weekly groceries',
                  payee_id: 'payee-store',
                  transfer_account_id: null,
                },
              ],
              subtransactions: [
                {
                  amount: -30000,
                  category_id: 'cat-groceries',
                  deleted: false,
                  id: 'sub-1',
                  memo: 'Food items',
                  payee_id: null,
                  transaction_id: 'txn-split',
                  transfer_account_id: null,
                },
                {
                  amount: -20000,
                  category_id: null,
                  deleted: false,
                  id: 'sub-2',
                  memo: 'Other items',
                  payee_id: null,
                  transaction_id: 'txn-split',
                  transfer_account_id: null,
                },
              ],
              transactions: [
                {
                  account_id: 'acc-checking',
                  amount: -50000,
                  approved: true,
                  category_id: 'cat-groceries',
                  cleared: 'cleared',
                  date: '2026-01-15',
                  deleted: false,
                  flag_color: null,
                  id: 'txn-1',
                  import_id: null,
                  import_payee_name: null,
                  import_payee_name_original: null,
                  memo: 'Weekly groceries',
                  payee_id: 'payee-store',
                  transfer_account_id: null,
                },
                {
                  account_id: 'acc-checking',
                  amount: -50000,
                  approved: false,
                  category_id: null,
                  cleared: 'uncleared',
                  date: '2026-01-16',
                  deleted: false,
                  flag_color: 'red',
                  id: 'txn-split',
                  import_id: null,
                  import_payee_name: null,
                  import_payee_name_original: null,
                  memo: 'Split transaction',
                  payee_id: 'payee-store',
                  transfer_account_id: null,
                },
                {
                  account_id: 'acc-checking',
                  amount: -10000,
                  approved: true,
                  category_id: 'cat-groceries',
                  cleared: 'cleared',
                  date: '2026-01-10',
                  deleted: true,
                  flag_color: null,
                  id: 'txn-deleted',
                  import_id: null,
                  import_payee_name: null,
                  import_payee_name_original: null,
                  memo: 'Deleted transaction',
                  payee_id: 'payee-store',
                  transfer_account_id: null,
                },
              ],
              ...overrides,
            },
            server_knowledge: 1,
          },
        });
      }),
    );
  };

  beforeEach(() => {
    vi.stubEnv('YNAB_ACCESS_TOKEN', 'fake-access-token');
    ynabClient.clearLocalBudgets();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('getTransactions()', () => {
    it('returns enriched transactions with resolved names', async () => {
      setupMockBudget();

      const transactions = await ynabClient.getTransactions(budgetId);

      // Should exclude deleted transaction
      expect(transactions).toHaveLength(2);

      // Check first transaction is fully enriched
      const txn1 = transactions.find((t) => t.id === 'txn-1');
      expect(txn1).toBeDefined();
      expect(txn1?.account_name).toBe('Checking');
      expect(txn1?.payee_name).toBe('Grocery Store');
      expect(txn1?.category_name).toBe('Groceries');
      expect(txn1?.category_group_name).toBe('Bills');
      // Milliunits: -50000 → Currency: -50
      expect(txn1?.amount_currency).toBe(-50);
    });

    it('enriches subtransactions with resolved names', async () => {
      setupMockBudget();

      const transactions = await ynabClient.getTransactions(budgetId);
      const splitTxn = transactions.find((t) => t.id === 'txn-split');

      expect(splitTxn).toBeDefined();
      expect(splitTxn?.subtransactions).toHaveLength(2);

      const sub1 = splitTxn?.subtransactions.find((s) => s.id === 'sub-1');
      expect(sub1?.category_name).toBe('Groceries');
      expect(sub1?.category_group_name).toBe('Bills');
      // Milliunits: -30000 → Currency: -30
      expect(sub1?.amount_currency).toBe(-30);
    });

    it('filters by account when accountId specified', async () => {
      setupMockBudget();

      const transactions = await ynabClient.getTransactions(budgetId, {
        accountId: 'acc-checking',
      });
      expect(transactions.length).toBeGreaterThan(0);

      const noTxns = await ynabClient.getTransactions(budgetId, {
        accountId: 'non-existent',
      });
      expect(noTxns).toHaveLength(0);
    });

    it('filters by date when sinceDate specified', async () => {
      setupMockBudget();

      const transactions = await ynabClient.getTransactions(budgetId, {
        sinceDate: '2026-01-16',
      });
      // Should only include txn-split (2026-01-16), not txn-1 (2026-01-15)
      expect(transactions).toHaveLength(1);
      expect(transactions[0]?.id).toBe('txn-split');
    });

    it('filters uncategorized when type specified', async () => {
      setupMockBudget();

      const uncategorized = await ynabClient.getTransactions(budgetId, {
        type: 'uncategorized',
      });
      expect(uncategorized).toHaveLength(1);
      expect(uncategorized[0]?.id).toBe('txn-split');
    });

    it('filters unapproved when type specified', async () => {
      setupMockBudget();

      const unapproved = await ynabClient.getTransactions(budgetId, {
        type: 'unapproved',
      });
      expect(unapproved).toHaveLength(1);
      expect(unapproved[0]?.id).toBe('txn-split');
    });
  });

  describe('getTransaction()', () => {
    it('returns enriched transaction by ID', async () => {
      setupMockBudget();

      const txn = await ynabClient.getTransaction(budgetId, 'txn-1');

      expect(txn.id).toBe('txn-1');
      expect(txn.account_name).toBe('Checking');
      expect(txn.payee_name).toBe('Grocery Store');
      expect(txn.category_name).toBe('Groceries');
    });

    it('throws specific error for deleted transaction', async () => {
      setupMockBudget();

      await expect(
        ynabClient.getTransaction(budgetId, 'txn-deleted'),
      ).rejects.toThrow("Transaction 'txn-deleted' has been deleted in YNAB.");
    });

    it('throws not found error for non-existent transaction', async () => {
      setupMockBudget();

      await expect(
        ynabClient.getTransaction(budgetId, 'non-existent'),
      ).rejects.toThrow("Transaction not found with ID: 'non-existent'.");
    });
  });

  describe('getScheduledTransactions()', () => {
    it('returns enriched scheduled transactions', async () => {
      setupMockBudget();

      const scheduled = await ynabClient.getScheduledTransactions(budgetId);

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]?.id).toBe('sched-1');
      expect(scheduled[0]?.account_name).toBe('Checking');
      expect(scheduled[0]?.payee_name).toBe('Grocery Store');
      expect(scheduled[0]?.category_name).toBe('Groceries');
      expect(scheduled[0]?.frequency).toBe('monthly');
      // Milliunits: -75000 → Currency: -75
      expect(scheduled[0]?.amount_currency).toBe(-75);
    });
  });

  describe('getBudgetMonths()', () => {
    it('returns enriched month summaries excluding deleted', async () => {
      setupMockBudget();

      const months = await ynabClient.getBudgetMonths(budgetId);

      // Should exclude deleted month
      expect(months).toHaveLength(1);
      expect(months[0]?.month).toBe('2026-01-01');
      // Milliunits: -100000 → Currency: -100 (divide by 1000)
      expect(months[0]?.activity_currency).toBe(-100);
      expect(months[0]?.budgeted_currency).toBe(500);
      expect(months[0]?.income_currency).toBe(300);
      expect(months[0]?.age_of_money).toBe(30);
    });
  });

  describe('getBudgetMonth()', () => {
    it('returns enriched month detail with categories', async () => {
      setupMockBudget();

      const month = await ynabClient.getBudgetMonth(budgetId, '2026-01-01');

      expect(month.month).toBe('2026-01-01');
      // Milliunits: -100000 → Currency: -100
      expect(month.activity_currency).toBe(-100);
      expect(month.categories).toHaveLength(1);
      expect(month.categories[0]?.name).toBe('Groceries');
      expect(month.categories[0]?.category_group_name).toBe('Bills');
      // Milliunits: 150000 → Currency: 150
      expect(month.categories[0]?.balance_currency).toBe(150);
    });

    it('throws specific error for deleted month', async () => {
      setupMockBudget();

      await expect(
        ynabClient.getBudgetMonth(budgetId, '2025-12-01'),
      ).rejects.toThrow("Budget month '2025-12-01' has been deleted in YNAB.");
    });

    it('throws not found error for non-existent month', async () => {
      setupMockBudget();

      await expect(
        ynabClient.getBudgetMonth(budgetId, '2020-01-01'),
      ).rejects.toThrow("Budget month not found: '2020-01-01'.");
    });
  });
});
