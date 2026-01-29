/**
 * Tests for drift-detection.ts
 */

import type {LocalBudget} from './types.js';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  checkForDrift,
  getDriftCheckIntervalMinutes,
  getDriftCheckIntervalSyncs,
  isAlwaysFullSyncEnabled,
  isDriftDetectionEnabled,
  logDriftCheckResult,
  recordDriftCheck,
  resetDriftCheckState,
  shouldPerformDriftCheck,
} from './drift-detection.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal LocalBudget for testing
 */
function createTestBudget(overrides: Partial<LocalBudget> = {}): LocalBudget {
  return {
    accountById: new Map(),
    accountByName: new Map(),
    accounts: [],
    budgetId: 'test-budget-id',
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
    serverKnowledge: 100,
    subtransactions: [],
    subtransactionsByTransactionId: new Map(),
    transactions: [],
    ...overrides,
  };
}

/**
 * Create a mock logger for testing
 */
function createMockLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

// ============================================================================
// Environment Variable Tests
// ============================================================================

describe('isDriftDetectionEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true when env var is not set (default)', () => {
    delete process.env['YNAB_DRIFT_DETECTION'];
    expect(isDriftDetectionEnabled()).toBe(true);
  });

  it('returns true when env var is empty string', () => {
    process.env['YNAB_DRIFT_DETECTION'] = '';
    expect(isDriftDetectionEnabled()).toBe(true);
  });

  it('returns false when env var is "false"', () => {
    process.env['YNAB_DRIFT_DETECTION'] = 'false';
    expect(isDriftDetectionEnabled()).toBe(false);
  });

  it('returns false when env var is "0"', () => {
    process.env['YNAB_DRIFT_DETECTION'] = '0';
    expect(isDriftDetectionEnabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env['YNAB_DRIFT_DETECTION'] = 'true';
    expect(isDriftDetectionEnabled()).toBe(true);
  });

  it('returns true when env var is "1"', () => {
    process.env['YNAB_DRIFT_DETECTION'] = '1';
    expect(isDriftDetectionEnabled()).toBe(true);
  });
});

describe('isAlwaysFullSyncEnabled', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when env var is not set (default)', () => {
    delete process.env['YNAB_ALWAYS_FULL_SYNC'];
    expect(isAlwaysFullSyncEnabled()).toBe(false);
  });

  it('returns false when env var is empty string', () => {
    process.env['YNAB_ALWAYS_FULL_SYNC'] = '';
    expect(isAlwaysFullSyncEnabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env['YNAB_ALWAYS_FULL_SYNC'] = 'true';
    expect(isAlwaysFullSyncEnabled()).toBe(true);
  });

  it('returns true when env var is "1"', () => {
    process.env['YNAB_ALWAYS_FULL_SYNC'] = '1';
    expect(isAlwaysFullSyncEnabled()).toBe(true);
  });

  it('returns false when env var is "false"', () => {
    process.env['YNAB_ALWAYS_FULL_SYNC'] = 'false';
    expect(isAlwaysFullSyncEnabled()).toBe(false);
  });
});

describe('getDriftCheckIntervalSyncs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 1 when env var is not set (default)', () => {
    delete process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'];
    expect(getDriftCheckIntervalSyncs()).toBe(1);
  });

  it('returns 1 when env var is empty string', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '';
    expect(getDriftCheckIntervalSyncs()).toBe(1);
  });

  it('returns parsed number when valid', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '10';
    expect(getDriftCheckIntervalSyncs()).toBe(10);
  });

  it('returns 1 when env var is NaN', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = 'invalid';
    expect(getDriftCheckIntervalSyncs()).toBe(1);
  });

  it('returns 1 when env var is less than 1', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '0';
    expect(getDriftCheckIntervalSyncs()).toBe(1);
  });

  it('returns 1 when env var is negative', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '-5';
    expect(getDriftCheckIntervalSyncs()).toBe(1);
  });
});

describe('getDriftCheckIntervalMinutes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {...originalEnv};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 0 when env var is not set (default)', () => {
    delete process.env['YNAB_DRIFT_CHECK_INTERVAL_MINUTES'];
    expect(getDriftCheckIntervalMinutes()).toBe(0);
  });

  it('returns 0 when env var is empty string', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_MINUTES'] = '';
    expect(getDriftCheckIntervalMinutes()).toBe(0);
  });

  it('returns parsed number when valid', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_MINUTES'] = '30';
    expect(getDriftCheckIntervalMinutes()).toBe(30);
  });

  it('returns 0 when env var is NaN', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_MINUTES'] = 'invalid';
    expect(getDriftCheckIntervalMinutes()).toBe(0);
  });

  it('returns 0 when env var is negative', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_MINUTES'] = '-5';
    expect(getDriftCheckIntervalMinutes()).toBe(0);
  });
});

// ============================================================================
// Drift Check Frequency Tests
// ============================================================================

describe('shouldPerformDriftCheck', () => {
  const originalEnv = process.env;
  const testBudgetId = 'test-budget-123';

  beforeEach(() => {
    vi.resetModules();
    process.env = {...originalEnv};
    resetDriftCheckState();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetDriftCheckState();
  });

  it('returns false when drift detection is disabled', () => {
    process.env['YNAB_DRIFT_DETECTION'] = 'false';
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(false);
  });

  it('returns false when always full sync is enabled', () => {
    process.env['YNAB_ALWAYS_FULL_SYNC'] = 'true';
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(false);
  });

  it('returns true on first call with default interval of 1', () => {
    delete process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'];
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(true);
  });

  it('returns true every call when interval is 1', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '1';
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(true);
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(true);
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(true);
  });

  it('returns true every N calls when interval is N', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '3';

    // Calls 1, 2 should return false, call 3 should return true
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(false); // call 1
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(false); // call 2
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(true); // call 3

    // Continue pattern
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(false); // call 4
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(false); // call 5
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(true); // call 6
  });

  it('tracks state independently per budget', () => {
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '2';

    const budgetA = 'budget-a';
    const budgetB = 'budget-b';

    // Budget A: call 1 (false), call 2 (true)
    expect(shouldPerformDriftCheck(budgetA)).toBe(false); // A call 1
    expect(shouldPerformDriftCheck(budgetA)).toBe(true); // A call 2

    // Budget B starts fresh, not affected by A's state
    expect(shouldPerformDriftCheck(budgetB)).toBe(false); // B call 1
    expect(shouldPerformDriftCheck(budgetB)).toBe(true); // B call 2

    // Budget A continues from its own state
    expect(shouldPerformDriftCheck(budgetA)).toBe(false); // A call 3
    expect(shouldPerformDriftCheck(budgetA)).toBe(true); // A call 4
  });
});

describe('recordDriftCheck and resetDriftCheckState', () => {
  const testBudgetId = 'test-budget-456';

  beforeEach(() => {
    resetDriftCheckState();
  });

  afterEach(() => {
    resetDriftCheckState();
  });

  it('recordDriftCheck does not throw', () => {
    expect(() => recordDriftCheck(testBudgetId)).not.toThrow();
  });

  it('resetDriftCheckState resets evaluation count for all budgets', () => {
    const originalEnv = process.env;
    process.env = {...originalEnv};
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '3';

    // Accumulate some calls
    shouldPerformDriftCheck(testBudgetId); // call 1
    shouldPerformDriftCheck(testBudgetId); // call 2

    // Reset all budgets
    resetDriftCheckState();

    // Should start fresh
    expect(shouldPerformDriftCheck(testBudgetId)).toBe(false); // call 1 again

    process.env = originalEnv;
  });

  it('resetDriftCheckState can reset a specific budget', () => {
    const originalEnv = process.env;
    process.env = {...originalEnv};
    process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'] = '3';

    const budgetA = 'budget-a';
    const budgetB = 'budget-b';

    // Accumulate calls for both budgets
    shouldPerformDriftCheck(budgetA); // A call 1
    shouldPerformDriftCheck(budgetA); // A call 2
    shouldPerformDriftCheck(budgetB); // B call 1
    shouldPerformDriftCheck(budgetB); // B call 2

    // Reset only budget A
    resetDriftCheckState(budgetA);

    // Budget A should start fresh
    expect(shouldPerformDriftCheck(budgetA)).toBe(false); // A call 1 again

    // Budget B should continue from its previous state (was at call 2, now call 3 = true)
    expect(shouldPerformDriftCheck(budgetB)).toBe(true); // B call 3

    process.env = originalEnv;
  });
});

// ============================================================================
// Drift Detection Tests
// ============================================================================

describe('checkForDrift', () => {
  it('returns no drift when budgets are identical', () => {
    const budget1 = createTestBudget({
      accounts: [{id: 'acc1', name: 'Checking'} as never],
      categories: [{id: 'cat1', name: 'Groceries'} as never],
      serverKnowledge: 100,
    });
    const budget2 = createTestBudget({
      accounts: [{id: 'acc1', name: 'Checking'} as never],
      categories: [{id: 'cat1', name: 'Groceries'} as never],
      serverKnowledge: 100,
    });

    const result = checkForDrift(budget1, budget2);

    expect(result.hasDrift).toBe(false);
    expect(result.differenceCount).toBe(0);
    expect(result.serverKnowledgeMismatch).toBe(false);
  });

  it('detects server knowledge mismatch', () => {
    const budget1 = createTestBudget({serverKnowledge: 100});
    const budget2 = createTestBudget({serverKnowledge: 150});

    const result = checkForDrift(budget1, budget2);

    expect(result.serverKnowledgeMismatch).toBe(true);
    expect(result.mergedServerKnowledge).toBe(100);
    expect(result.truthServerKnowledge).toBe(150);
  });

  it('detects missing entity (in truth but not in merged)', () => {
    const merged = createTestBudget({
      accounts: [{id: 'acc1', name: 'Checking'} as never],
    });
    const truth = createTestBudget({
      accounts: [
        {id: 'acc1', name: 'Checking'} as never,
        {id: 'acc2', name: 'Savings'} as never,
      ],
    });

    const result = checkForDrift(merged, truth);

    expect(result.hasDrift).toBe(true);
    expect(result.differenceCount).toBeGreaterThan(0);
    expect(result.differenceSummary['accounts']).toBeGreaterThan(0);
  });

  it('detects extra entity (in merged but not in truth)', () => {
    const merged = createTestBudget({
      accounts: [
        {id: 'acc1', name: 'Checking'} as never,
        {id: 'acc2', name: 'Savings'} as never,
      ],
    });
    const truth = createTestBudget({
      accounts: [{id: 'acc1', name: 'Checking'} as never],
    });

    const result = checkForDrift(merged, truth);

    expect(result.hasDrift).toBe(true);
    expect(result.differenceCount).toBeGreaterThan(0);
  });

  it('detects value difference', () => {
    const merged = createTestBudget({
      accounts: [{balance: 1000, id: 'acc1', name: 'Checking'} as never],
    });
    const truth = createTestBudget({
      accounts: [{balance: 2000, id: 'acc1', name: 'Checking'} as never],
    });

    const result = checkForDrift(merged, truth);

    expect(result.hasDrift).toBe(true);
    expect(result.differenceCount).toBeGreaterThan(0);
  });

  it('ignores lookup maps in comparison', () => {
    const budget1 = createTestBudget();
    const budget2 = createTestBudget();

    // Add different items to lookup maps
    budget1.accountById.set('acc1', {id: 'acc1', name: 'A'} as never);
    budget2.accountById.set('acc1', {id: 'acc1', name: 'B'} as never);

    // Should not detect drift because maps are not compared
    const result = checkForDrift(budget1, budget2);

    expect(result.hasDrift).toBe(false);
  });

  it('provides difference summary by category', () => {
    const merged = createTestBudget({
      accounts: [{id: 'acc1', name: 'A'} as never],
      categories: [{id: 'cat1', name: 'C'} as never],
    });
    const truth = createTestBudget({
      accounts: [{id: 'acc1', name: 'B'} as never], // Different name
      categories: [{id: 'cat1', name: 'D'} as never], // Different name
    });

    const result = checkForDrift(merged, truth);

    expect(result.hasDrift).toBe(true);
    expect(result.differenceSummary).toHaveProperty('accounts');
    expect(result.differenceSummary).toHaveProperty('categories');
  });
});

// ============================================================================
// Logging Tests
// ============================================================================

describe('logDriftCheckResult', () => {
  it('logs success message when no drift', () => {
    const logger = createMockLogger();
    const result = checkForDrift(createTestBudget(), createTestBudget());

    logDriftCheckResult(result, 'test-budget', logger);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Drift check passed'),
      expect.any(Object),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs warning when server knowledge mismatch', () => {
    const logger = createMockLogger();
    const result = checkForDrift(
      createTestBudget({serverKnowledge: 100}),
      createTestBudget({serverKnowledge: 150}),
    );

    logDriftCheckResult(result, 'test-budget', logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Server knowledge mismatch'),
      expect.any(Object),
    );
  });

  it('logs error when drift detected', () => {
    const logger = createMockLogger();
    const merged = createTestBudget({
      accounts: [{id: 'acc1', name: 'Checking'} as never],
    });
    const truth = createTestBudget({
      accounts: [{id: 'acc1', name: 'Different'} as never],
    });
    const result = checkForDrift(merged, truth);

    logDriftCheckResult(result, 'test-budget', logger);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('DRIFT DETECTED'),
      expect.any(Object),
    );
  });

  it('logs self-healing message when drift detected', () => {
    const logger = createMockLogger();
    const merged = createTestBudget({
      accounts: [{id: 'acc1', name: 'A'} as never],
    });
    const truth = createTestBudget({
      accounts: [{id: 'acc1', name: 'B'} as never],
    });
    const result = checkForDrift(merged, truth);

    logDriftCheckResult(result, 'test-budget', logger);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Self-healing'),
    );
  });

  it('limits detailed difference logging to 5', () => {
    const logger = createMockLogger();

    // Create budgets with many differences
    const merged = createTestBudget({
      accounts: [
        {f1: 1, id: 'a1', name: 'n1'} as never,
        {f2: 2, id: 'a2', name: 'n2'} as never,
        {f3: 3, id: 'a3', name: 'n3'} as never,
        {f4: 4, id: 'a4', name: 'n4'} as never,
        {f5: 5, id: 'a5', name: 'n5'} as never,
        {f6: 6, id: 'a6', name: 'n6'} as never,
        {f7: 7, id: 'a7', name: 'n7'} as never,
      ],
    });
    const truth = createTestBudget({
      accounts: [
        {f1: 10, id: 'a1', name: 'x1'} as never,
        {f2: 20, id: 'a2', name: 'x2'} as never,
        {f3: 30, id: 'a3', name: 'x3'} as never,
        {f4: 40, id: 'a4', name: 'x4'} as never,
        {f5: 50, id: 'a5', name: 'x5'} as never,
        {f6: 60, id: 'a6', name: 'x6'} as never,
        {f7: 70, id: 'a7', name: 'x7'} as never,
      ],
    });
    const result = checkForDrift(merged, truth);

    logDriftCheckResult(result, 'test-budget', logger);

    // Should log "and X more differences" message
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('more differences'),
    );
  });
});
