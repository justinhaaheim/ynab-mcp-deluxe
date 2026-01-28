/**
 * Tests for LocalBudget building and merging utilities.
 */

import type {LocalBudget} from './types.js';
import type {
  Account,
  BudgetDetail,
  Category,
  CategoryGroup,
  MonthDetail,
  Payee,
} from 'ynab';

import {beforeEach, describe, expect, it} from 'vitest';

import {
  buildLocalBudget,
  detectDrift,
  mergeDelta,
  mergeEntityArray,
  mergeMonthArray,
  rebuildLookupMaps,
} from './local-budget.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockAccount(overrides: Partial<Account> = {}): Account {
  return {
    balance: 100000,
    cleared_balance: 100000,
    closed: false,
    deleted: false,
    id: 'account-1',
    name: 'Checking',
    on_budget: true,
    transfer_payee_id: 'transfer-payee-1',
    type: 'checking',
    uncleared_balance: 0,
    ...overrides,
  };
}

function createMockCategory(overrides: Partial<Category> = {}): Category {
  return {
    activity: -50000,
    balance: 50000,
    budgeted: 100000,
    category_group_id: 'group-1',
    category_group_name: 'Bills',
    deleted: false,
    goal_cadence: null,
    goal_cadence_frequency: null,
    goal_creation_month: null,
    goal_day: null,
    goal_months_to_budget: null,
    goal_overall_funded: null,
    goal_overall_left: null,
    goal_percentage_complete: null,
    goal_target: null,
    goal_target_month: null,
    goal_type: null,
    goal_under_funded: null,
    hidden: false,
    id: 'category-1',
    name: 'Rent',
    note: null,
    original_category_group_id: null,
    ...overrides,
  };
}

function createMockPayee(overrides: Partial<Payee> = {}): Payee {
  return {
    deleted: false,
    id: 'payee-1',
    name: 'Amazon',
    transfer_account_id: null,
    ...overrides,
  };
}

function createMockCategoryGroup(
  overrides: Partial<CategoryGroup> = {},
): CategoryGroup {
  return {
    deleted: false,
    hidden: false,
    id: 'group-1',
    name: 'Bills',
    ...overrides,
  };
}

function createMockMonth(overrides: Partial<MonthDetail> = {}): MonthDetail {
  return {
    activity: -100000,
    age_of_money: 30,
    budgeted: 500000,
    categories: [],
    deleted: false,
    income: 600000,
    month: '2026-01-01',
    note: null,
    to_be_budgeted: 100000,
    ...overrides,
  };
}

function createMockBudgetDetail(
  overrides: Partial<BudgetDetail> = {},
): BudgetDetail {
  return {
    accounts: [createMockAccount()],
    categories: [createMockCategory()],
    category_groups: [createMockCategoryGroup()],
    currency_format: {
      currency_symbol: '$',
      decimal_digits: 2,
      decimal_separator: '.',
      display_symbol: true,
      example_format: '123,456.78',
      group_separator: ',',
      iso_code: 'USD',
      symbol_first: true,
    },
    date_format: {format: 'YYYY-MM-DD'},
    id: 'budget-1',
    last_modified_on: '2026-01-26T12:00:00Z',
    months: [createMockMonth()],
    name: 'My Budget',
    payee_locations: [],
    payees: [createMockPayee()],
    scheduled_subtransactions: [],
    scheduled_transactions: [],
    subtransactions: [],
    transactions: [],
    ...overrides,
  };
}

function createEmptyLocalBudget(): LocalBudget {
  return {
    accountById: new Map(),
    accountByName: new Map(),
    accounts: [],
    budgetId: 'budget-1',
    budgetName: 'Test Budget',
    categories: [],
    categoryById: new Map(),
    categoryByName: new Map(),
    categoryGroupNameById: new Map(),
    categoryGroups: [],
    currencyFormat: null,
    lastSyncedAt: new Date(),
    months: [],
    needsSync: false,
    payeeById: new Map(),
    payeeLocations: [],
    payees: [],
    scheduledSubtransactions: [],
    scheduledSubtransactionsByScheduledTransactionId: new Map(),
    scheduledTransactions: [],
    serverKnowledge: 1000,
    subtransactions: [],
    subtransactionsByTransactionId: new Map(),
    transactions: [],
  };
}

// ============================================================================
// mergeEntityArray Tests
// ============================================================================

describe('mergeEntityArray', () => {
  it('should add new entities', () => {
    const existing = [
      {id: '1', name: 'First'},
      {id: '2', name: 'Second'},
    ];
    const delta = [{id: '3', name: 'Third'}];

    const result = mergeEntityArray(existing, delta);

    expect(result).toHaveLength(3);
    expect(result.find((e) => e.id === '3')).toEqual({id: '3', name: 'Third'});
  });

  it('should update existing entities', () => {
    const existing = [
      {id: '1', name: 'Original'},
      {id: '2', name: 'Second'},
    ];
    const delta = [{id: '1', name: 'Updated'}];

    const result = mergeEntityArray(existing, delta);

    expect(result).toHaveLength(2);
    expect(result.find((e) => e.id === '1')).toEqual({
      id: '1',
      name: 'Updated',
    });
  });

  it('should remove deleted entities', () => {
    const existing = [
      {id: '1', name: 'First'},
      {id: '2', name: 'Second'},
      {id: '3', name: 'Third'},
    ];
    const delta = [{deleted: true, id: '2', name: 'Second'}];

    const result = mergeEntityArray(existing, delta);

    expect(result).toHaveLength(2);
    expect(result.find((e) => e.id === '2')).toBeUndefined();
  });

  it('should handle empty existing array', () => {
    const existing: {id: string; name: string}[] = [];
    const delta = [{id: '1', name: 'New'}];

    const result = mergeEntityArray(existing, delta);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({id: '1', name: 'New'});
  });

  it('should handle empty delta array', () => {
    const existing = [
      {id: '1', name: 'First'},
      {id: '2', name: 'Second'},
    ];
    const delta: {id: string; name: string}[] = [];

    const result = mergeEntityArray(existing, delta);

    expect(result).toHaveLength(2);
    expect(result).toEqual(existing);
  });

  it('should handle mixed operations (add, update, delete)', () => {
    const existing = [
      {id: '1', name: 'One'},
      {id: '2', name: 'Two'},
      {id: '3', name: 'Three'},
    ];
    const delta = [
      {id: '1', name: 'One Updated'}, // update
      {deleted: true, id: '2', name: 'Two'}, // delete
      {id: '4', name: 'Four'}, // add
    ];

    const result = mergeEntityArray(existing, delta);

    expect(result).toHaveLength(3);
    expect(result.find((e) => e.id === '1')?.name).toBe('One Updated');
    expect(result.find((e) => e.id === '2')).toBeUndefined();
    expect(result.find((e) => e.id === '3')?.name).toBe('Three');
    expect(result.find((e) => e.id === '4')?.name).toBe('Four');
  });

  it('should not modify deleted flag if explicitly false', () => {
    const existing = [{deleted: false, id: '1', name: 'First'}];
    const delta = [{deleted: false, id: '1', name: 'Updated'}];

    const result = mergeEntityArray(existing, delta);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({deleted: false, id: '1', name: 'Updated'});
  });
});

// ============================================================================
// mergeMonthArray Tests
// ============================================================================

describe('mergeMonthArray', () => {
  it('should add new months', () => {
    const existing = [createMockMonth({month: '2026-01-01'})];
    const delta = [createMockMonth({budgeted: 600000, month: '2026-02-01'})];

    const result = mergeMonthArray(existing, delta);

    expect(result).toHaveLength(2);
    expect(result.find((m) => m.month === '2026-02-01')?.budgeted).toBe(600000);
  });

  it('should update existing months', () => {
    const existing = [createMockMonth({budgeted: 500000, month: '2026-01-01'})];
    const delta = [createMockMonth({budgeted: 750000, month: '2026-01-01'})];

    const result = mergeMonthArray(existing, delta);

    expect(result).toHaveLength(1);
    expect(result[0]?.budgeted).toBe(750000);
  });

  it('should handle empty existing array', () => {
    const existing: MonthDetail[] = [];
    const delta = [createMockMonth({month: '2026-01-01'})];

    const result = mergeMonthArray(existing, delta);

    expect(result).toHaveLength(1);
  });

  it('should handle empty delta array', () => {
    const existing = [
      createMockMonth({month: '2026-01-01'}),
      createMockMonth({month: '2026-02-01'}),
    ];
    const delta: MonthDetail[] = [];

    const result = mergeMonthArray(existing, delta);

    expect(result).toHaveLength(2);
  });

  it('should handle deleted months defensively', () => {
    const existing = [
      createMockMonth({month: '2026-01-01'}),
      createMockMonth({month: '2026-02-01'}),
    ];
    // Cast to add deleted flag even though MonthDetail doesn't have it
    const delta = [
      {...createMockMonth({month: '2026-01-01'}), deleted: true},
    ] as MonthDetail[];

    const result = mergeMonthArray(existing, delta);

    expect(result).toHaveLength(1);
    expect(result[0]?.month).toBe('2026-02-01');
  });

  it('should merge nested categories array when updating existing month', () => {
    // Existing month has 3 categories
    const existingCategories = [
      createMockCategory({budgeted: 100000, id: 'cat-1', name: 'Rent'}),
      createMockCategory({budgeted: 50000, id: 'cat-2', name: 'Groceries'}),
      createMockCategory({budgeted: 20000, id: 'cat-3', name: 'Utilities'}),
    ];
    const existing = [
      createMockMonth({
        categories: existingCategories,
        month: '2026-01-01',
      }),
    ];

    // Delta only includes ONE changed category (cat-2 with updated budgeted)
    const deltaCategories = [
      createMockCategory({budgeted: 75000, id: 'cat-2', name: 'Groceries'}),
    ];
    const delta = [
      createMockMonth({
        budgeted: 600000, // Updated scalar field
        categories: deltaCategories,
        month: '2026-01-01',
      }),
    ];

    const result = mergeMonthArray(existing, delta);

    // Should have 1 month
    expect(result).toHaveLength(1);
    const mergedMonth = result[0];

    // Scalar field should be updated from delta
    expect(mergedMonth?.budgeted).toBe(600000);

    // Should have all 3 categories (merged, not replaced)
    expect(mergedMonth?.categories).toHaveLength(3);

    // cat-1 should be preserved unchanged
    const cat1 = mergedMonth?.categories.find((c) => c.id === 'cat-1');
    expect(cat1?.budgeted).toBe(100000);

    // cat-2 should be updated from delta
    const cat2 = mergedMonth?.categories.find((c) => c.id === 'cat-2');
    expect(cat2?.budgeted).toBe(75000);

    // cat-3 should be preserved unchanged
    const cat3 = mergedMonth?.categories.find((c) => c.id === 'cat-3');
    expect(cat3?.budgeted).toBe(20000);
  });

  it('should handle deleted categories within merged month', () => {
    const existingCategories = [
      createMockCategory({id: 'cat-1', name: 'Rent'}),
      createMockCategory({id: 'cat-2', name: 'Groceries'}),
      createMockCategory({id: 'cat-3', name: 'Utilities'}),
    ];
    const existing = [
      createMockMonth({
        categories: existingCategories,
        month: '2026-01-01',
      }),
    ];

    // Delta marks cat-2 as deleted
    const deltaCategories = [
      createMockCategory({deleted: true, id: 'cat-2', name: 'Groceries'}),
    ];
    const delta = [
      createMockMonth({
        categories: deltaCategories,
        month: '2026-01-01',
      }),
    ];

    const result = mergeMonthArray(existing, delta);

    expect(result).toHaveLength(1);
    const mergedMonth = result[0];

    // Should have 2 categories (cat-2 was deleted)
    expect(mergedMonth?.categories).toHaveLength(2);
    expect(mergedMonth?.categories.find((c) => c.id === 'cat-1')).toBeDefined();
    expect(
      mergedMonth?.categories.find((c) => c.id === 'cat-2'),
    ).toBeUndefined();
    expect(mergedMonth?.categories.find((c) => c.id === 'cat-3')).toBeDefined();
  });

  it('should add new categories to existing month', () => {
    const existingCategories = [
      createMockCategory({id: 'cat-1', name: 'Rent'}),
    ];
    const existing = [
      createMockMonth({
        categories: existingCategories,
        month: '2026-01-01',
      }),
    ];

    // Delta adds a new category
    const deltaCategories = [
      createMockCategory({id: 'cat-new', name: 'New Category'}),
    ];
    const delta = [
      createMockMonth({
        categories: deltaCategories,
        month: '2026-01-01',
      }),
    ];

    const result = mergeMonthArray(existing, delta);

    expect(result).toHaveLength(1);
    const mergedMonth = result[0];

    // Should have 2 categories
    expect(mergedMonth?.categories).toHaveLength(2);
    expect(mergedMonth?.categories.find((c) => c.id === 'cat-1')).toBeDefined();
    expect(
      mergedMonth?.categories.find((c) => c.id === 'cat-new'),
    ).toBeDefined();
  });
});

// ============================================================================
// rebuildLookupMaps Tests
// ============================================================================

describe('rebuildLookupMaps', () => {
  let localBudget: LocalBudget;

  beforeEach(() => {
    localBudget = createEmptyLocalBudget();
  });

  it('should build account lookup maps', () => {
    const account1 = createMockAccount({id: 'acc-1', name: 'Checking'});
    const account2 = createMockAccount({id: 'acc-2', name: 'Savings'});
    localBudget.accounts = [account1, account2];

    rebuildLookupMaps(localBudget);

    expect(localBudget.accountById.get('acc-1')).toBe(account1);
    expect(localBudget.accountById.get('acc-2')).toBe(account2);
    expect(localBudget.accountByName.get('checking')).toBe(account1);
    expect(localBudget.accountByName.get('savings')).toBe(account2);
  });

  it('should build category lookup maps', () => {
    const category1 = createMockCategory({id: 'cat-1', name: 'Rent'});
    const category2 = createMockCategory({id: 'cat-2', name: 'Groceries'});
    localBudget.categories = [category1, category2];

    rebuildLookupMaps(localBudget);

    expect(localBudget.categoryById.get('cat-1')).toBe(category1);
    expect(localBudget.categoryById.get('cat-2')).toBe(category2);
    expect(localBudget.categoryByName.get('rent')).toBe(category1);
    expect(localBudget.categoryByName.get('groceries')).toBe(category2);
  });

  it('should build category group name map', () => {
    const group1 = createMockCategoryGroup({id: 'grp-1', name: 'Bills'});
    const group2 = createMockCategoryGroup({id: 'grp-2', name: 'Fun Money'});
    localBudget.categoryGroups = [group1, group2];

    rebuildLookupMaps(localBudget);

    expect(localBudget.categoryGroupNameById.get('grp-1')).toBe('Bills');
    expect(localBudget.categoryGroupNameById.get('grp-2')).toBe('Fun Money');
  });

  it('should build payee lookup map', () => {
    const payee1 = createMockPayee({id: 'pay-1', name: 'Amazon'});
    const payee2 = createMockPayee({id: 'pay-2', name: 'Walmart'});
    localBudget.payees = [payee1, payee2];

    rebuildLookupMaps(localBudget);

    expect(localBudget.payeeById.get('pay-1')).toBe(payee1);
    expect(localBudget.payeeById.get('pay-2')).toBe(payee2);
  });

  it('should clear existing maps before rebuilding', () => {
    localBudget.accounts = [createMockAccount({id: 'acc-1', name: 'Old'})];
    rebuildLookupMaps(localBudget);

    // Change accounts
    localBudget.accounts = [createMockAccount({id: 'acc-2', name: 'New'})];
    rebuildLookupMaps(localBudget);

    expect(localBudget.accountById.has('acc-1')).toBe(false);
    expect(localBudget.accountById.has('acc-2')).toBe(true);
    expect(localBudget.accountByName.has('old')).toBe(false);
    expect(localBudget.accountByName.has('new')).toBe(true);
  });

  it('should handle case-insensitive name lookups', () => {
    localBudget.accounts = [
      createMockAccount({id: 'acc-1', name: 'My Checking Account'}),
    ];
    localBudget.categories = [createMockCategory({id: 'cat-1', name: 'RENT'})];

    rebuildLookupMaps(localBudget);

    expect(localBudget.accountByName.get('my checking account')).toBeDefined();
    expect(localBudget.categoryByName.get('rent')).toBeDefined();
  });
});

// ============================================================================
// buildLocalBudget Tests
// ============================================================================

describe('buildLocalBudget', () => {
  it('should build LocalBudget from BudgetDetail', () => {
    const budgetDetail = createMockBudgetDetail();

    const result = buildLocalBudget('budget-123', budgetDetail, 5000);

    expect(result.budgetId).toBe('budget-123');
    expect(result.budgetName).toBe('My Budget');
    expect(result.serverKnowledge).toBe(5000);
    expect(result.needsSync).toBe(false);
    expect(result.accounts).toHaveLength(1);
    expect(result.categories).toHaveLength(1);
    expect(result.payees).toHaveLength(1);
  });

  it('should populate lookup maps', () => {
    const budgetDetail = createMockBudgetDetail({
      accounts: [
        createMockAccount({id: 'acc-1', name: 'Checking'}),
        createMockAccount({id: 'acc-2', name: 'Savings'}),
      ],
    });

    const result = buildLocalBudget('budget-123', budgetDetail, 5000);

    expect(result.accountById.size).toBe(2);
    expect(result.accountByName.size).toBe(2);
    expect(result.accountById.get('acc-1')?.name).toBe('Checking');
  });

  it('should handle null/undefined arrays', () => {
    const budgetDetail = createMockBudgetDetail({
      accounts: undefined,
      categories: undefined,
      payees: undefined,
    });

    const result = buildLocalBudget('budget-123', budgetDetail, 5000);

    expect(result.accounts).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.payees).toEqual([]);
  });

  it('should set lastSyncedAt to current time', () => {
    const before = new Date();
    const budgetDetail = createMockBudgetDetail();

    const result = buildLocalBudget('budget-123', budgetDetail, 5000);

    const after = new Date();
    expect(result.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(result.lastSyncedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// mergeDelta Tests
// ============================================================================

describe('mergeDelta', () => {
  let existingBudget: LocalBudget;

  beforeEach(() => {
    existingBudget = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [
          createMockAccount({balance: 100000, id: 'acc-1', name: 'Checking'}),
          createMockAccount({balance: 200000, id: 'acc-2', name: 'Savings'}),
        ],
        categories: [
          createMockCategory({id: 'cat-1', name: 'Rent'}),
          createMockCategory({id: 'cat-2', name: 'Food'}),
        ],
        payees: [createMockPayee({id: 'pay-1', name: 'Amazon'})],
      }),
      1000,
    );
  });

  it('should merge new entities from delta', () => {
    const deltaBudget = createMockBudgetDetail({
      accounts: [createMockAccount({id: 'acc-3', name: 'Investment'})],
      categories: [],
      payees: [],
    });

    const {localBudget} = mergeDelta(existingBudget, deltaBudget, 1001);

    expect(localBudget.accounts).toHaveLength(3);
    expect(localBudget.accountById.get('acc-3')?.name).toBe('Investment');
  });

  it('should update existing entities from delta', () => {
    const deltaBudget = createMockBudgetDetail({
      accounts: [
        createMockAccount({balance: 150000, id: 'acc-1', name: 'Checking'}),
      ],
      categories: [],
      payees: [],
    });

    const {localBudget} = mergeDelta(existingBudget, deltaBudget, 1001);

    expect(localBudget.accounts).toHaveLength(2);
    expect(localBudget.accountById.get('acc-1')?.balance).toBe(150000);
  });

  it('should remove deleted entities from delta', () => {
    const deltaBudget = createMockBudgetDetail({
      accounts: [createMockAccount({deleted: true, id: 'acc-2'})],
      categories: [],
      payees: [],
    });

    const {localBudget} = mergeDelta(existingBudget, deltaBudget, 1001);

    expect(localBudget.accounts).toHaveLength(1);
    expect(localBudget.accountById.has('acc-2')).toBe(false);
  });

  it('should update serverKnowledge', () => {
    const deltaBudget = createMockBudgetDetail({
      accounts: [],
      categories: [],
      payees: [],
    });

    const {localBudget} = mergeDelta(existingBudget, deltaBudget, 2000);

    expect(localBudget.serverKnowledge).toBe(2000);
  });

  it('should reset needsSync to false', () => {
    existingBudget.needsSync = true;
    const deltaBudget = createMockBudgetDetail({
      accounts: [],
      categories: [],
      payees: [],
    });

    const {localBudget} = mergeDelta(existingBudget, deltaBudget, 1001);

    expect(localBudget.needsSync).toBe(false);
  });

  it('should return accurate change counts', () => {
    const deltaBudget = createMockBudgetDetail({
      accounts: [
        createMockAccount({id: 'acc-3'}),
        createMockAccount({id: 'acc-4'}),
      ],
      categories: [createMockCategory({id: 'cat-3'})],
      months: [createMockMonth({month: '2026-03-01'})],
      payees: [],
    });

    const {changesReceived} = mergeDelta(existingBudget, deltaBudget, 1001);

    expect(changesReceived.accounts).toBe(2);
    expect(changesReceived.categories).toBe(1);
    expect(changesReceived.months).toBe(1);
    expect(changesReceived.payees).toBe(0);
  });

  it('should rebuild lookup maps after merge', () => {
    const deltaBudget = createMockBudgetDetail({
      accounts: [createMockAccount({id: 'acc-new', name: 'New Account'})],
      categories: [],
      payees: [],
    });

    const {localBudget} = mergeDelta(existingBudget, deltaBudget, 1001);

    expect(localBudget.accountById.get('acc-new')?.name).toBe('New Account');
    expect(localBudget.accountByName.get('new account')).toBeDefined();
  });

  it('should handle empty delta (no changes)', () => {
    const deltaBudget = createMockBudgetDetail({
      accounts: [],
      categories: [],
      category_groups: [],
      months: [],
      payee_locations: [],
      payees: [],
      scheduled_subtransactions: [],
      scheduled_transactions: [],
      subtransactions: [],
      transactions: [],
    });

    const {localBudget, changesReceived} = mergeDelta(
      existingBudget,
      deltaBudget,
      1001,
    );

    // Counts should all be zero
    expect(changesReceived.accounts).toBe(0);
    expect(changesReceived.categories).toBe(0);

    // Existing data should be preserved
    expect(localBudget.accounts).toHaveLength(2);
    expect(localBudget.categories).toHaveLength(2);
    expect(localBudget.payees).toHaveLength(1);
  });
});

// ============================================================================
// detectDrift Tests (simple array length comparison)
// ============================================================================

describe('detectDrift', () => {
  it('should return empty array when budgets match', () => {
    const local = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [createMockAccount()],
        categories: [createMockCategory()],
      }),
      1000,
    );
    const remote = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [createMockAccount()],
        categories: [createMockCategory()],
      }),
      1000,
    );

    const result = detectDrift(local, remote);

    expect(result).toEqual([]);
  });

  it('should detect account count drift', () => {
    const local = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [createMockAccount()],
      }),
      1000,
    );
    const remote = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [createMockAccount({id: '1'}), createMockAccount({id: '2'})],
      }),
      1000,
    );

    const result = detectDrift(local, remote);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('accounts');
    expect(result[0]).toContain('drift=1');
  });

  it('should detect multiple drifts', () => {
    const local = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [createMockAccount()],
        categories: [createMockCategory()],
        payees: [createMockPayee()],
      }),
      1000,
    );
    const remote = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [createMockAccount({id: '1'}), createMockAccount({id: '2'})],
        categories: [],
        payees: [
          createMockPayee({id: '1'}),
          createMockPayee({id: '2'}),
          createMockPayee({id: '3'}),
        ],
      }),
      1000,
    );

    const result = detectDrift(local, remote);

    expect(result).toHaveLength(3);
    expect(result.some((d) => d.includes('accounts'))).toBe(true);
    expect(result.some((d) => d.includes('categories'))).toBe(true);
    expect(result.some((d) => d.includes('payees'))).toBe(true);
  });

  it('should report negative drift (remote has fewer)', () => {
    const local = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [
          createMockAccount({id: '1'}),
          createMockAccount({id: '2'}),
          createMockAccount({id: '3'}),
        ],
      }),
      1000,
    );
    const remote = buildLocalBudget(
      'budget-1',
      createMockBudgetDetail({
        accounts: [createMockAccount({id: '1'})],
      }),
      1000,
    );

    const result = detectDrift(local, remote);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('drift=-2');
  });
});
