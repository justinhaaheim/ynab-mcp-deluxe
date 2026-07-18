/**
 * Delta Sync Investigation Script
 *
 * Empirically tests YNAB's delta sync behavior by:
 * 1. Making controlled mutations via the API
 * 2. Fetching both delta and full responses
 * 3. Merging delta into previous state
 * 4. Comparing merged result vs full fetch (truth)
 * 5. Saving detailed artifacts for analysis
 *
 * Usage: YNAB_ACCESS_TOKEN=<token> bun run scripts/delta-sync-investigation.ts
 *
 * All mutations are reversed after each test for clean state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ynab from 'ynab';

import {checkForDrift} from '../src/drift-detection.js';
import {buildLocalBudget, mergeDelta} from '../src/local-budget.js';

// ============================================================================
// Configuration
// ============================================================================

const BUDGET_ID = '1feb7f66-f7ba-48a9-8d90-8a399175113e';
const TOKEN = process.env['YNAB_ACCESS_TOKEN'];

if (TOKEN === undefined || TOKEN === '') {
  console.error('ERROR: Set YNAB_ACCESS_TOKEN environment variable');
  process.exit(1);
}

const api = new ynab.API(TOKEN);

// Output directory for artifacts
const OUTPUT_DIR = path.join(
  process.cwd(),
  'delta-investigation-results',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

// ============================================================================
// Types
// ============================================================================

interface TestResult {
  cleanup: string;
  deltaArraySummary: Record<string, number>;
  driftResult: {
    differenceCount: number;
    differenceSummary: Record<string, number>;
    hasDrift: boolean;
    serverKnowledgeMismatch: boolean;
  };
  mutation: string;
  name: string;
  observations: string[];
  serverKnowledge: {
    afterDelta: number;
    afterFull: number;
    before: number;
  };
  status: 'PASS' | 'FAIL' | 'WARN' | 'ERROR';
}

// ============================================================================
// Helpers
// ============================================================================

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, {recursive: true});
}

function saveJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/** Summarize which arrays in a BudgetDetail have entries and how many */
function summarizeDeltaArrays(budget: ynab.PlanDetail): Record<string, number> {
  const summary: Record<string, number> = {};
  const arrays: (keyof ynab.PlanDetail)[] = [
    'accounts',
    'payees',
    'payee_locations',
    'category_groups',
    'categories',
    'months',
    'transactions',
    'subtransactions',
    'scheduled_transactions',
    'scheduled_subtransactions',
  ];

  for (const key of arrays) {
    const arr = budget[key];
    if (Array.isArray(arr) && arr.length > 0) {
      summary[key] = arr.length;
    }
  }

  return summary;
}

/** Wait to avoid rate limiting */
async function pause(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Get today's date in YYYY-MM-DD format */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get a future date for scheduled transactions */
function futureDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/** Get current month in YYYY-MM-DD format (first of month) */
function currentMonth(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ============================================================================
// Core Test Infrastructure
// ============================================================================

/** Fetch full budget (no delta) */
async function fetchFull(): Promise<{
  budget: ynab.PlanDetail;
  serverKnowledge: number;
}> {
  const response = await api.plans.getPlanById(BUDGET_ID);
  return {
    budget: response.data.plan,
    serverKnowledge: response.data.server_knowledge,
  };
}

/** Fetch delta budget */
async function fetchDelta(lastKnowledge: number): Promise<{
  budget: ynab.PlanDetail;
  serverKnowledge: number;
}> {
  const response = await api.plans.getPlanById(BUDGET_ID, lastKnowledge);
  return {
    budget: response.data.plan,
    serverKnowledge: response.data.server_knowledge,
  };
}

/**
 * Run a single test:
 * 1. Use the baseline (previous full fetch)
 * 2. Execute the mutation
 * 3. Fetch delta and full
 * 4. Compare
 * 5. Run cleanup
 * 6. Fetch new full for next test's baseline
 */
async function runTest(
  name: string,
  mutation: string,
  baselineBudget: ynab.PlanDetail,
  baselineKnowledge: number,
  mutate: () => Promise<string[]>, // Returns observation notes
  cleanup: () => Promise<void>,
): Promise<{
  newBaseline: {budget: ynab.PlanDetail; serverKnowledge: number};
  result: TestResult;
}> {
  const testDir = path.join(OUTPUT_DIR, name);
  ensureDir(testDir);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log(`  Mutation: ${mutation}`);
  console.log(`  Baseline serverKnowledge: ${String(baselineKnowledge)}`);
  console.log(`${'='.repeat(60)}`);

  const observations: string[] = [];

  try {
    // Step 1: Execute mutation
    console.log('  [1/6] Executing mutation...');
    const mutationNotes = await mutate();
    observations.push(...mutationNotes);
    await pause();

    // Step 2: Fetch delta
    console.log('  [2/6] Fetching delta...');
    const delta = await fetchDelta(baselineKnowledge);
    console.log(`  Delta serverKnowledge: ${String(delta.serverKnowledge)}`);
    await pause();

    // Step 3: Merge delta into baseline
    console.log('  [3/6] Merging delta into baseline...');
    const baselineLocal = buildLocalBudget(
      BUDGET_ID,
      baselineBudget,
      baselineKnowledge,
    );
    const {localBudget: mergedLocal} = mergeDelta(
      baselineLocal,
      delta.budget,
      delta.serverKnowledge,
    );

    // Step 4: Fetch full (truth)
    console.log('  [4/6] Fetching full budget (truth)...');
    const full = await fetchFull();
    console.log(`  Full serverKnowledge: ${String(full.serverKnowledge)}`);
    await pause();

    // Step 5: Compare
    console.log('  [5/6] Comparing merged vs full...');
    const truthLocal = buildLocalBudget(
      BUDGET_ID,
      full.budget,
      full.serverKnowledge,
    );
    const driftResult = checkForDrift(mergedLocal, truthLocal);

    // Check for server knowledge mismatch (external changes)
    if (driftResult.serverKnowledgeMismatch) {
      observations.push(
        `serverKnowledge mismatch: delta=${String(delta.serverKnowledge)}, full=${String(full.serverKnowledge)}. External changes may have occurred between fetches.`,
      );
    }

    // Summarize delta arrays
    const deltaArraySummary = summarizeDeltaArrays(delta.budget);
    console.log(
      `  Delta arrays with data: ${JSON.stringify(deltaArraySummary)}`,
    );

    if (driftResult.hasDrift) {
      console.log(
        `  DRIFT DETECTED: ${String(driftResult.differenceCount)} differences`,
      );
      console.log(
        `  Summary: ${JSON.stringify(driftResult.differenceSummary)}`,
      );
    } else {
      console.log('  No drift -- merged matches full exactly');
    }

    // Save artifacts
    saveJson(path.join(testDir, 'baseline-budget.json'), baselineBudget);
    saveJson(path.join(testDir, 'delta-response.json'), delta.budget);
    saveJson(
      path.join(testDir, 'delta-arrays-summary.json'),
      deltaArraySummary,
    );
    saveJson(path.join(testDir, 'full-response.json'), full.budget);
    saveJson(path.join(testDir, 'drift-result.json'), {
      differenceCount: driftResult.differenceCount,
      differenceSummary: driftResult.differenceSummary,
      differences: driftResult.differences,
      hasDrift: driftResult.hasDrift,
      serverKnowledge: {
        baseline: baselineKnowledge,
        delta: delta.serverKnowledge,
        full: full.serverKnowledge,
      },
      serverKnowledgeMismatch: driftResult.serverKnowledgeMismatch,
    });

    // Step 6: Cleanup
    console.log('  [6/6] Cleaning up...');
    await cleanup();
    await pause();

    // Fetch new baseline for next test
    const newBaseline = await fetchFull();
    await pause();

    const status = driftResult.hasDrift
      ? driftResult.serverKnowledgeMismatch
        ? 'WARN'
        : 'FAIL'
      : 'PASS';

    return {
      newBaseline,
      result: {
        cleanup: 'success',
        deltaArraySummary,
        driftResult: {
          differenceCount: driftResult.differenceCount,
          differenceSummary: driftResult.differenceSummary,
          hasDrift: driftResult.hasDrift,
          serverKnowledgeMismatch: driftResult.serverKnowledgeMismatch,
        },
        mutation,
        name,
        observations,
        serverKnowledge: {
          afterDelta: delta.serverKnowledge,
          afterFull: full.serverKnowledge,
          before: baselineKnowledge,
        },
        status,
      },
    };
  } catch (error) {
    console.error(
      `  ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );

    // Try cleanup even on error
    try {
      await cleanup();
    } catch {
      console.error('  Cleanup also failed');
    }

    // Get new baseline
    const newBaseline = await fetchFull();

    return {
      newBaseline,
      result: {
        cleanup: 'attempted',
        deltaArraySummary: {},
        driftResult: {
          differenceCount: -1,
          differenceSummary: {},
          hasDrift: false,
          serverKnowledgeMismatch: false,
        },
        mutation,
        name,
        observations: [
          ...observations,
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ],
        serverKnowledge: {
          afterDelta: -1,
          afterFull: -1,
          before: baselineKnowledge,
        },
        status: 'ERROR',
      },
    };
  }
}

// ============================================================================
// Test Definitions
// ============================================================================

async function runAllTests(): Promise<void> {
  ensureDir(OUTPUT_DIR);
  console.log(`\nDelta Sync Investigation`);
  console.log(`Budget: ${BUDGET_ID}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // We need an account and category to use for transactions
  // Fetch them from the budget
  console.log('Fetching initial budget to find account and category IDs...');
  let baseline = await fetchFull();
  await pause();

  const accounts = baseline.budget.accounts ?? [];
  const categories = baseline.budget.categories ?? [];

  // Find a usable checking/savings account (not closed, not deleted)
  const testAccount = accounts.find(
    (a) => !a.closed && !a.deleted && a.on_budget,
  );
  if (testAccount === undefined) {
    console.error('ERROR: No suitable on-budget account found in test budget');
    process.exit(1);
  }
  console.log(`Using account: "${testAccount.name}" (${testAccount.id})`);

  // Find two usable categories (not deleted, not hidden)
  const usableCategories = categories.filter(
    (c) => !c.deleted && !c.hidden && c.name !== 'Uncategorized',
  );
  const cat1 = usableCategories[0];
  const cat2 = usableCategories[1];
  if (cat1 === undefined || cat2 === undefined) {
    console.error('ERROR: Need at least 2 usable categories');
    process.exit(1);
  }
  console.log(`Using categories: "${cat1.name}", "${cat2.name}"`);

  const results: TestResult[] = [];

  // Track items created for cleanup
  let createdTransactionId: string | null = null;
  let splitTransactionId: string | null = null;
  let scheduledTransactionId: string | null = null;

  // --------------------------------------------------------------------------
  // Test 1: Create a simple transaction
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '01_create_transaction',
      'Create a simple transaction',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        const resp = await api.transactions.createTransaction(BUDGET_ID, {
          transaction: {
            account_id: testAccount.id,
            amount: -12340, // -$12.34
            approved: true,
            category_id: cat1.id,
            cleared: ynab.TransactionClearedStatus.Cleared,
            date: today(),
            memo: 'DELTA_TEST_01: create transaction',
          },
        });
        createdTransactionId =
          resp.data.transaction?.id ?? resp.data.transactions?.[0]?.id ?? null;
        return [
          `Created transaction: ${String(createdTransactionId)}`,
          `Response contained transaction: ${String(resp.data.transaction !== undefined)}`,
          `Response contained transactions array: ${String((resp.data.transactions?.length ?? 0) > 0)}`,
        ];
      },
      async () => {
        // Don't clean up yet -- we need it for tests 2 and 3
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 2: Update the transaction (change amount)
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '02_update_transaction',
      'Edit transaction amount',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        if (createdTransactionId === null)
          throw new Error('No transaction from test 1');
        await api.transactions.updateTransaction(
          BUDGET_ID,
          createdTransactionId,
          {
            transaction: {
              account_id: testAccount.id,
              amount: -56780, // Changed to -$56.78
              category_id: cat1.id,
              cleared: ynab.TransactionClearedStatus.Cleared,
              date: today(),
              memo: 'DELTA_TEST_02: updated amount',
            },
          },
        );
        return ['Updated transaction amount from -12340 to -56780'];
      },
      async () => {
        // Don't clean up yet -- we need it for test 3
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 3: Delete the transaction
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '03_delete_transaction',
      'Delete the transaction',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        if (createdTransactionId === null)
          throw new Error('No transaction from test 1');
        await api.transactions.deleteTransaction(
          BUDGET_ID,
          createdTransactionId,
        );
        return [`Deleted transaction: ${createdTransactionId}`];
      },
      async () => {
        createdTransactionId = null;
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 4: Create a split transaction (with subtransactions)
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '04_create_split_transaction',
      'Create a split transaction with subtransactions',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        const resp = await api.transactions.createTransaction(BUDGET_ID, {
          transaction: {
            account_id: testAccount.id,
            amount: -100000, // -$100.00
            approved: true,
            cleared: ynab.TransactionClearedStatus.Cleared,
            date: today(),
            memo: 'DELTA_TEST_04: split transaction',
            subtransactions: [
              {
                amount: -60000,
                category_id: cat1.id,
                memo: 'Split part A',
              },
              {
                amount: -40000,
                category_id: cat2.id,
                memo: 'Split part B',
              },
            ],
          },
        });
        splitTransactionId =
          resp.data.transaction?.id ?? resp.data.transactions?.[0]?.id ?? null;
        return [
          `Created split transaction: ${String(splitTransactionId)}`,
          `Subtransactions in response: ${String(resp.data.transaction?.subtransactions?.length ?? 'N/A')}`,
        ];
      },
      async () => {
        // Don't clean up yet -- needed for test 5 and 6
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 5: Update a subtransaction (edit parent with new subtransactions)
  // Note: YNAB API doesn't support updating subtransactions directly.
  // We update the parent transaction memo instead.
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '05_update_split_parent',
      'Update split transaction parent memo',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        if (splitTransactionId === null)
          throw new Error('No split transaction from test 4');
        await api.transactions.updateTransaction(
          BUDGET_ID,
          splitTransactionId,
          {
            transaction: {
              account_id: testAccount.id,
              amount: -100000,
              cleared: ynab.TransactionClearedStatus.Cleared,
              date: today(),
              memo: 'DELTA_TEST_05: updated memo on split',
            },
          },
        );
        return [
          'Updated split transaction parent memo',
          'Note: YNAB API does not support updating subtransactions directly on existing splits',
        ];
      },
      async () => {
        // Don't clean up yet -- needed for test 6
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 6: Delete the split transaction
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '06_delete_split_transaction',
      'Delete split transaction -- check subtransaction cascade',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        if (splitTransactionId === null)
          throw new Error('No split transaction from test 4');
        await api.transactions.deleteTransaction(BUDGET_ID, splitTransactionId);
        return [`Deleted split transaction: ${splitTransactionId}`];
      },
      async () => {
        splitTransactionId = null;
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 7: Change a category budget amount
  // --------------------------------------------------------------------------
  {
    // Save original budget amount for restoration
    const monthStr = currentMonth();
    let originalBudgeted: number | null = null;

    const {result, newBaseline} = await runTest(
      '07_change_category_budget',
      `Set budget amount for "${cat1.name}" in ${monthStr}`,
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        // Get current budgeted amount
        const monthResp = await api.categories.getMonthCategoryById(
          BUDGET_ID,
          monthStr,
          cat1.id,
        );
        originalBudgeted = monthResp.data.category.budgeted;

        const newAmount = originalBudgeted + 50000; // Add $50
        await api.categories.updateMonthCategory(BUDGET_ID, monthStr, cat1.id, {
          category: {budgeted: newAmount},
        });
        return [
          `Original budgeted: ${String(originalBudgeted)}`,
          `New budgeted: ${String(newAmount)}`,
          `Month: ${monthStr}`,
        ];
      },
      async () => {
        // Restore original budget amount
        if (originalBudgeted !== null) {
          await api.categories.updateMonthCategory(
            BUDGET_ID,
            monthStr,
            cat1.id,
            {
              category: {budgeted: originalBudgeted},
            },
          );
        }
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 8: Move money between categories
  // --------------------------------------------------------------------------
  {
    const monthStr = currentMonth();
    let originalCat1Budgeted: number | null = null;
    let originalCat2Budgeted: number | null = null;

    const {result, newBaseline} = await runTest(
      '08_move_money_between_categories',
      `Move money between "${cat1.name}" and "${cat2.name}"`,
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        // Get current amounts
        const [resp1, resp2] = await Promise.all([
          api.categories.getMonthCategoryById(BUDGET_ID, monthStr, cat1.id),
          api.categories.getMonthCategoryById(BUDGET_ID, monthStr, cat2.id),
        ]);
        originalCat1Budgeted = resp1.data.category.budgeted;
        originalCat2Budgeted = resp2.data.category.budgeted;

        // Move $25 from cat1 to cat2
        await api.categories.updateMonthCategory(BUDGET_ID, monthStr, cat1.id, {
          category: {budgeted: originalCat1Budgeted - 25000},
        });
        await pause(300);
        await api.categories.updateMonthCategory(BUDGET_ID, monthStr, cat2.id, {
          category: {budgeted: originalCat2Budgeted + 25000},
        });
        return [
          `Moved $25 from "${cat1.name}" to "${cat2.name}"`,
          `Cat1: ${String(originalCat1Budgeted)} -> ${String(originalCat1Budgeted - 25000)}`,
          `Cat2: ${String(originalCat2Budgeted)} -> ${String(originalCat2Budgeted + 25000)}`,
        ];
      },
      async () => {
        if (originalCat1Budgeted !== null && originalCat2Budgeted !== null) {
          await api.categories.updateMonthCategory(
            BUDGET_ID,
            monthStr,
            cat1.id,
            {category: {budgeted: originalCat1Budgeted}},
          );
          await pause(300);
          await api.categories.updateMonthCategory(
            BUDGET_ID,
            monthStr,
            cat2.id,
            {category: {budgeted: originalCat2Budgeted}},
          );
        }
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 9: Create a scheduled transaction
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '09_create_scheduled_transaction',
      'Create a scheduled transaction',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        const resp = await api.scheduledTransactions.createScheduledTransaction(
          BUDGET_ID,
          {
            scheduled_transaction: {
              account_id: testAccount.id,
              amount: -33330,
              category_id: cat1.id,
              date: futureDate(),
              frequency: ynab.ScheduledTransactionFrequency.Never,
              memo: 'DELTA_TEST_09: scheduled transaction',
            },
          },
        );
        scheduledTransactionId = resp.data.scheduled_transaction?.id ?? null;
        return [
          `Created scheduled transaction: ${String(scheduledTransactionId)}`,
        ];
      },
      async () => {
        // Don't clean up yet -- needed for test 10
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 10: Delete the scheduled transaction
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline} = await runTest(
      '10_delete_scheduled_transaction',
      'Delete the scheduled transaction',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        if (scheduledTransactionId === null)
          throw new Error('No scheduled transaction from test 9');
        await api.scheduledTransactions.deleteScheduledTransaction(
          BUDGET_ID,
          scheduledTransactionId,
        );
        return [`Deleted scheduled transaction: ${scheduledTransactionId}`];
      },
      async () => {
        scheduledTransactionId = null;
        await Promise.resolve();
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 11: Compound changes (multiple entity types at once)
  // --------------------------------------------------------------------------
  {
    const monthStr = currentMonth();
    let origBudgeted: number | null = null;
    const compoundTxnIds: string[] = [];

    const {result, newBaseline} = await runTest(
      '11_compound_changes',
      'Create 2 transactions + change category budget',
      baseline.budget,
      baseline.serverKnowledge,
      async () => {
        // Create 2 transactions
        const resp = await api.transactions.createTransaction(BUDGET_ID, {
          transactions: [
            {
              account_id: testAccount.id,
              amount: -11110,
              approved: true,
              category_id: cat1.id,
              cleared: ynab.TransactionClearedStatus.Cleared,
              date: today(),
              memo: 'DELTA_TEST_11A: compound test txn 1',
            },
            {
              account_id: testAccount.id,
              amount: -22220,
              approved: true,
              category_id: cat2.id,
              cleared: ynab.TransactionClearedStatus.Cleared,
              date: today(),
              memo: 'DELTA_TEST_11B: compound test txn 2',
            },
          ],
        });

        if (resp.data.transactions !== undefined) {
          for (const t of resp.data.transactions) {
            compoundTxnIds.push(t.id);
          }
        }

        await pause(300);

        // Change category budget
        const catResp = await api.categories.getMonthCategoryById(
          BUDGET_ID,
          monthStr,
          cat1.id,
        );
        origBudgeted = catResp.data.category.budgeted;
        await api.categories.updateMonthCategory(BUDGET_ID, monthStr, cat1.id, {
          category: {budgeted: origBudgeted + 75000},
        });

        return [
          `Created ${String(compoundTxnIds.length)} transactions: ${compoundTxnIds.join(', ')}`,
          `Updated budget: ${String(origBudgeted)} -> ${String(origBudgeted + 75000)}`,
        ];
      },
      async () => {
        // Delete created transactions
        for (const id of compoundTxnIds) {
          await api.transactions.deleteTransaction(BUDGET_ID, id);
          await pause(200);
        }
        // Restore budget
        if (origBudgeted !== null) {
          await api.categories.updateMonthCategory(
            BUDGET_ID,
            monthStr,
            cat1.id,
            {category: {budgeted: origBudgeted}},
          );
        }
      },
    );
    results.push(result);
    baseline = newBaseline;
  }

  // --------------------------------------------------------------------------
  // Test 12: No-op delta (no changes)
  // --------------------------------------------------------------------------
  {
    const {result, newBaseline: _} = await runTest(
      '12_noop_delta',
      'No changes -- verify empty delta',
      baseline.budget,
      baseline.serverKnowledge,
      () => {
        // No mutation
        return Promise.resolve([
          'No mutation performed -- testing empty delta response',
        ]);
      },
      async () => {
        // No cleanup needed
        await Promise.resolve();
      },
    );
    results.push(result);
  }

  // ============================================================================
  // Summary Report
  // ============================================================================

  console.log('\n\n');
  console.log('='.repeat(70));
  console.log('SUMMARY REPORT');
  console.log('='.repeat(70));
  console.log('');

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const errorCount = results.filter((r) => r.status === 'ERROR').length;

  console.log(
    `Results: ${String(passCount)} PASS, ${String(failCount)} FAIL, ${String(warnCount)} WARN, ${String(errorCount)} ERROR`,
  );
  console.log('');

  for (const r of results) {
    const icon =
      r.status === 'PASS'
        ? 'PASS'
        : r.status === 'FAIL'
          ? 'FAIL'
          : r.status === 'WARN'
            ? 'WARN'
            : 'ERROR';
    console.log(`[${icon}] ${r.name}: ${r.status}`);
    console.log(`   Mutation: ${r.mutation}`);
    console.log(
      `   ServerKnowledge: ${String(r.serverKnowledge.before)} -> delta:${String(r.serverKnowledge.afterDelta)} / full:${String(r.serverKnowledge.afterFull)}`,
    );
    if (Object.keys(r.deltaArraySummary).length > 0) {
      console.log(`   Delta arrays: ${JSON.stringify(r.deltaArraySummary)}`);
    }
    if (r.driftResult.hasDrift) {
      console.log(
        `   Drift: ${String(r.driftResult.differenceCount)} differences -- ${JSON.stringify(r.driftResult.differenceSummary)}`,
      );
      if (r.driftResult.serverKnowledgeMismatch) {
        console.log(
          `   serverKnowledge mismatch -- differences may be from external changes`,
        );
      }
    }
    if (r.observations.length > 0) {
      for (const obs of r.observations) {
        console.log(`   Note: ${obs}`);
      }
    }
    console.log('');
  }

  // Save full summary
  saveJson(path.join(OUTPUT_DIR, 'summary.json'), {
    budgetId: BUDGET_ID,
    counts: {
      error: errorCount,
      fail: failCount,
      pass: passCount,
      warn: warnCount,
    },
    results,
    timestamp: new Date().toISOString(),
  });

  console.log(`\nFull artifacts saved to: ${OUTPUT_DIR}`);
  console.log(
    `\nAPI calls used: ~${String(results.length * 4 + 10)} (well within 200/hr limit)`,
  );
}

// ============================================================================
// Entry point
// ============================================================================

runAllTests().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
