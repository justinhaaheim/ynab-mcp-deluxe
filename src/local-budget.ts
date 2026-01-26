/**
 * LocalBudget building and merging utilities.
 *
 * This module handles:
 * - Building a LocalBudget from a full YNAB API response
 * - Merging delta sync responses into an existing LocalBudget
 * - Rebuilding O(1) lookup maps after modifications
 */

import type {LocalBudget} from './types.js';
import type {
  Account,
  BudgetDetail,
  Category,
  CategoryGroup,
  MonthDetail,
  Payee,
  PayeeLocation,
  ScheduledSubTransaction,
  ScheduledTransactionSummary,
  SubTransaction,
  TransactionSummary,
} from 'ynab';

/**
 * Entity with an ID and optional deleted flag (for delta sync)
 */
interface EntityWithId {
  deleted?: boolean;
  id: string;
}

/**
 * Rebuild all O(1) lookup maps from the arrays in a LocalBudget.
 * Call this after any modification to the arrays.
 *
 * @param localBudget - The LocalBudget to rebuild maps for (mutated in place)
 */
export function rebuildLookupMaps(localBudget: LocalBudget): void {
  // Account maps
  localBudget.accountById.clear();
  localBudget.accountByName.clear();
  for (const account of localBudget.accounts) {
    localBudget.accountById.set(account.id, account);
    localBudget.accountByName.set(account.name.toLowerCase(), account);
  }

  // Category maps
  localBudget.categoryById.clear();
  localBudget.categoryByName.clear();
  for (const category of localBudget.categories) {
    localBudget.categoryById.set(category.id, category);
    localBudget.categoryByName.set(category.name.toLowerCase(), category);
  }

  // Category group name map
  localBudget.categoryGroupNameById.clear();
  for (const group of localBudget.categoryGroups) {
    localBudget.categoryGroupNameById.set(group.id, group.name);
  }

  // Payee map
  localBudget.payeeById.clear();
  for (const payee of localBudget.payees) {
    localBudget.payeeById.set(payee.id, payee);
  }
}

/**
 * Build a LocalBudget from a full YNAB API budget response.
 *
 * @param budgetId - The budget ID
 * @param budget - The BudgetDetail from YNAB API
 * @param serverKnowledge - The server_knowledge from the API response
 * @returns A fully populated LocalBudget with lookup maps
 */
export function buildLocalBudget(
  budgetId: string,
  budget: BudgetDetail,
  serverKnowledge: number,
): LocalBudget {
  const localBudget: LocalBudget = {
    // Lookup maps (will be populated by rebuildLookupMaps)
    accountById: new Map(),
    accountByName: new Map(),

    // Budget data (arrays from the API response)
    accounts: budget.accounts ?? [],
    // Budget identity
    budgetId,
    budgetName: budget.name,
    categories: budget.categories ?? [],
    categoryById: new Map(),
    categoryByName: new Map(),
    categoryGroupNameById: new Map(),
    categoryGroups: budget.category_groups ?? [],

    // Budget settings
    currencyFormat: budget.currency_format ?? null,

    // Sync metadata
    lastSyncedAt: new Date(),
    months: budget.months ?? [],
    needsSync: false,
    payeeById: new Map(),
    payeeLocations: budget.payee_locations ?? [],
    payees: budget.payees ?? [],
    scheduledSubtransactions: budget.scheduled_subtransactions ?? [],
    scheduledTransactions: budget.scheduled_transactions ?? [],
    serverKnowledge,
    subtransactions: budget.subtransactions ?? [],
    transactions: budget.transactions ?? [],
  };

  // Build the lookup maps
  rebuildLookupMaps(localBudget);

  return localBudget;
}

/**
 * Merge an array of entities from a delta response into an existing array.
 * Handles additions, updates, and deletions (entities with deleted: true).
 *
 * @param existing - The current array of entities
 * @param delta - The delta array from the API (may include deleted entities)
 * @returns A new merged array with deletions removed
 */
export function mergeEntityArray<T extends EntityWithId>(
  existing: T[],
  delta: T[],
): T[] {
  // Build a map from existing entities
  const byId = new Map<string, T>();
  for (const entity of existing) {
    byId.set(entity.id, entity);
  }

  // Apply delta changes
  for (const entity of delta) {
    if (entity.deleted === true) {
      // Remove deleted entities
      byId.delete(entity.id);
    } else {
      // Add or update entity
      byId.set(entity.id, entity);
    }
  }

  return Array.from(byId.values());
}

/**
 * Merge an array of MonthDetail entities (keyed by 'month' instead of 'id').
 * MonthDetail doesn't have an 'id' field - it uses 'month' as its unique key.
 *
 * @param existing - The current array of months
 * @param delta - The delta array from the API
 * @returns A new merged array
 */
export function mergeMonthArray(
  existing: MonthDetail[],
  delta: MonthDetail[],
): MonthDetail[] {
  // Build a map from existing months using 'month' as key
  const byMonth = new Map<string, MonthDetail>();
  for (const month of existing) {
    byMonth.set(month.month, month);
  }

  // Apply delta changes (MonthDetail doesn't have 'deleted' flag typically,
  // but we'll handle it just in case)
  for (const month of delta) {
    // MonthDetail type doesn't have 'deleted', but handle it defensively
    const asAny = month as MonthDetail & {deleted?: boolean};
    if (asAny.deleted === true) {
      byMonth.delete(month.month);
    } else {
      byMonth.set(month.month, month);
    }
  }

  return Array.from(byMonth.values());
}

/**
 * Count changes in a delta array.
 *
 * @param delta - The delta array from the API
 * @returns The number of entities in the delta
 */
function countChanges<T>(delta: T[] | undefined): number {
  return delta?.length ?? 0;
}

/**
 * Merge a delta sync response into an existing LocalBudget.
 * Returns a new LocalBudget with the merged data.
 *
 * @param existing - The current LocalBudget
 * @param deltaBudget - The delta BudgetDetail from YNAB API
 * @param newServerKnowledge - The new server_knowledge from the delta response
 * @returns A new LocalBudget with merged data and change counts
 */
export function mergeDelta(
  existing: LocalBudget,
  deltaBudget: BudgetDetail,
  newServerKnowledge: number,
): {
  changesReceived: {
    accounts: number;
    categories: number;
    months: number;
    payees: number;
    scheduledTransactions: number;
    transactions: number;
  };
  localBudget: LocalBudget;
} {
  // Count changes before merging
  const changesReceived = {
    accounts: countChanges(deltaBudget.accounts),
    categories: countChanges(deltaBudget.categories),
    months: countChanges(deltaBudget.months),
    payees: countChanges(deltaBudget.payees),
    scheduledTransactions: countChanges(deltaBudget.scheduled_transactions),
    transactions: countChanges(deltaBudget.transactions),
  };

  // Create new LocalBudget with merged arrays
  const localBudget: LocalBudget = {
    // Lookup maps (will be rebuilt)
    accountById: new Map(),
    accountByName: new Map(),

    // Merge all entity arrays
    accounts: mergeEntityArray<Account>(
      existing.accounts,
      deltaBudget.accounts ?? [],
    ),
    // Budget identity (unchanged)
    budgetId: existing.budgetId,
    budgetName: deltaBudget.name ?? existing.budgetName,
    categories: mergeEntityArray<Category>(
      existing.categories,
      deltaBudget.categories ?? [],
    ),
    categoryById: new Map(),
    categoryByName: new Map(),
    categoryGroupNameById: new Map(),
    categoryGroups: mergeEntityArray<CategoryGroup>(
      existing.categoryGroups,
      deltaBudget.category_groups ?? [],
    ),

    // Budget settings (may be updated)
    currencyFormat: deltaBudget.currency_format ?? existing.currencyFormat,

    // Update sync metadata
    lastSyncedAt: new Date(),
    months: mergeMonthArray(existing.months, deltaBudget.months ?? []),
    needsSync: false,
    payeeById: new Map(),
    payeeLocations: mergeEntityArray<PayeeLocation>(
      existing.payeeLocations,
      deltaBudget.payee_locations ?? [],
    ),
    payees: mergeEntityArray<Payee>(existing.payees, deltaBudget.payees ?? []),
    scheduledSubtransactions: mergeEntityArray<ScheduledSubTransaction>(
      existing.scheduledSubtransactions,
      deltaBudget.scheduled_subtransactions ?? [],
    ),
    scheduledTransactions: mergeEntityArray<ScheduledTransactionSummary>(
      existing.scheduledTransactions,
      deltaBudget.scheduled_transactions ?? [],
    ),
    serverKnowledge: newServerKnowledge,
    subtransactions: mergeEntityArray<SubTransaction>(
      existing.subtransactions,
      deltaBudget.subtransactions ?? [],
    ),
    transactions: mergeEntityArray<TransactionSummary>(
      existing.transactions,
      deltaBudget.transactions ?? [],
    ),
  };

  // Rebuild lookup maps
  rebuildLookupMaps(localBudget);

  return {changesReceived, localBudget};
}

/**
 * Compare two LocalBudgets and report any discrepancies.
 * Useful for sanity checking after a full re-fetch.
 *
 * @param local - The local budget (before full re-fetch)
 * @param remote - The remote budget (from full re-fetch)
 * @returns Array of discrepancy descriptions, empty if no drift
 */
export function detectDrift(local: LocalBudget, remote: LocalBudget): string[] {
  const discrepancies: string[] = [];

  // Check array lengths
  const checks: {field: keyof LocalBudget; name: string}[] = [
    {field: 'accounts', name: 'accounts'},
    {field: 'categories', name: 'categories'},
    {field: 'categoryGroups', name: 'categoryGroups'},
    {field: 'months', name: 'months'},
    {field: 'payees', name: 'payees'},
    {field: 'transactions', name: 'transactions'},
    {field: 'scheduledTransactions', name: 'scheduledTransactions'},
  ];

  for (const {field, name} of checks) {
    const localArray = local[field] as unknown[];
    const remoteArray = remote[field] as unknown[];

    if (localArray.length !== remoteArray.length) {
      discrepancies.push(
        `${name}: local=${localArray.length}, remote=${remoteArray.length}, drift=${remoteArray.length - localArray.length}`,
      );
    }
  }

  return discrepancies;
}
