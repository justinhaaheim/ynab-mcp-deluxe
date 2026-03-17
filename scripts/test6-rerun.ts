/**
 * Re-run of test 6 (delete split transaction).
 * This test previously crashed due to the YNAB SDK's MonthDetail null categories bug.
 * Fixed via bun patch (patches/ynab@2.10.0.patch).
 *
 * Usage: YNAB_ACCESS_TOKEN=<token> bun run scripts/test6-rerun.ts
 */

import * as ynab from 'ynab';

import {checkForDrift} from '../src/drift-detection.js';
import {buildLocalBudget, mergeDelta} from '../src/local-budget.js';

const BUDGET_ID = '1feb7f66-f7ba-48a9-8d90-8a399175113e';
const TOKEN = process.env['YNAB_ACCESS_TOKEN'];
if (TOKEN === undefined || TOKEN === '') {
  console.error('ERROR: Set YNAB_ACCESS_TOKEN');
  process.exit(1);
}

const api = new ynab.API(TOKEN);

async function run(): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);

  console.log('Fetching baseline...');
  const baseResp = await api.budgets.getBudgetById(BUDGET_ID);
  const baseBudget = baseResp.data.budget;
  const baseKnowledge = baseResp.data.server_knowledge;
  console.log('Baseline serverKnowledge: ' + String(baseKnowledge));

  const accounts = baseBudget.accounts ?? [];
  const account = accounts.find(
    (a) => a.closed === false && a.deleted === false && a.on_budget,
  );
  const allCategories = baseBudget.categories ?? [];
  const categories = allCategories.filter(
    (c) =>
      c.deleted === false && c.hidden === false && c.name !== 'Uncategorized',
  );
  const cat1 = categories[0];
  const cat2 = categories[1];
  if (account === undefined || cat1 === undefined || cat2 === undefined) {
    console.error('Need account + 2 categories');
    process.exit(1);
  }

  console.log('Creating split transaction...');
  const createResp = await api.transactions.createTransaction(BUDGET_ID, {
    transaction: {
      account_id: account.id,
      amount: -100000,
      approved: true,
      cleared: ynab.TransactionClearedStatus.Cleared,
      date: todayStr,
      memo: 'TEST6_RERUN: split transaction',
      subtransactions: [
        {amount: -60000, category_id: cat1.id, memo: 'Split A'},
        {amount: -40000, category_id: cat2.id, memo: 'Split B'},
      ],
    },
  });
  const txnId =
    createResp.data.transaction?.id ?? createResp.data.transactions?.[0]?.id;
  if (txnId === undefined) {
    console.error('Failed to create transaction');
    process.exit(1);
  }
  console.log('Created split transaction: ' + txnId);

  console.log('Fetching new baseline after creation...');
  const midResp = await api.budgets.getBudgetById(BUDGET_ID);
  const midBudget = midResp.data.budget;
  const midKnowledge = midResp.data.server_knowledge;
  console.log('Mid serverKnowledge: ' + String(midKnowledge));

  console.log('Deleting split transaction...');
  await api.transactions.deleteTransaction(BUDGET_ID, txnId);

  console.log('Fetching delta (previously crashed here)...');
  const deltaResp = await api.budgets.getBudgetById(BUDGET_ID, midKnowledge);
  const deltaBudget = deltaResp.data.budget;
  const deltaKnowledge = deltaResp.data.server_knowledge;
  console.log('Delta serverKnowledge: ' + String(deltaKnowledge));
  console.log('Delta fetch SUCCEEDED (was crashing before patch)');

  const deltaArrays: Record<string, number> = {};
  for (const key of [
    'accounts',
    'categories',
    'months',
    'transactions',
    'subtransactions',
  ] as const) {
    const arr = deltaBudget[key];
    if (Array.isArray(arr) && arr.length > 0) {
      deltaArrays[key] = arr.length;
    }
  }
  console.log('Delta arrays: ' + JSON.stringify(deltaArrays));

  const deltaTxns = deltaBudget.transactions ?? [];
  const deltaSubs = deltaBudget.subtransactions ?? [];
  const deletedTxns = deltaTxns.filter((t) => t.deleted);
  const deletedSubs = deltaSubs.filter((s) => s.deleted);
  console.log('Deleted transactions in delta: ' + String(deletedTxns.length));
  console.log(
    'Deleted subtransactions in delta: ' + String(deletedSubs.length),
  );

  console.log('Merging delta into baseline...');
  const baseLocal = buildLocalBudget(BUDGET_ID, midBudget, midKnowledge);
  const {localBudget: mergedLocal} = mergeDelta(
    baseLocal,
    deltaBudget,
    deltaKnowledge,
  );

  console.log('Fetching full budget (truth)...');
  const fullResp = await api.budgets.getBudgetById(BUDGET_ID);
  const fullBudget = fullResp.data.budget;
  const fullKnowledge = fullResp.data.server_knowledge;
  console.log('Full serverKnowledge: ' + String(fullKnowledge));

  const truthLocal = buildLocalBudget(BUDGET_ID, fullBudget, fullKnowledge);
  const driftResult = checkForDrift(mergedLocal, truthLocal);

  if (driftResult.hasDrift) {
    console.log(
      'DRIFT DETECTED: ' + String(driftResult.differenceCount) + ' differences',
    );
    console.log('Summary: ' + JSON.stringify(driftResult.differenceSummary));
  } else {
    console.log('No drift -- merged matches full exactly!');
  }

  console.log('');
  console.log('=== TEST 6 RERUN RESULTS ===');
  console.log('Split transaction deletion cascade:');
  console.log(
    '  Parent txn deleted in delta: ' +
      String(deletedTxns.length > 0) +
      ' (' +
      String(deletedTxns.length) +
      ' total)',
  );
  console.log(
    '  Subtransactions deleted in delta: ' +
      String(deletedSubs.length > 0) +
      ' (' +
      String(deletedSubs.length) +
      ' total)',
  );
  console.log(
    '  Merge correct (no drift): ' + String(driftResult.hasDrift === false),
  );
}

run().catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
