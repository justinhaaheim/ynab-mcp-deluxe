/**
 * Drift detection for LocalBudget.
 *
 * This module compares a merged LocalBudget (base + deltas) against a fresh
 * full budget fetch to detect any discrepancies in our merge logic.
 *
 * When drift is detected:
 * 1. Log detailed warnings showing what differs
 * 2. Self-heal by replacing local budget with the full fetch result
 */

import type {LocalBudget} from './types.js';
import type {Diff, DiffArray, DiffDeleted, DiffEdit, DiffNew} from 'deep-diff';

import deepDiff from 'deep-diff';

// ============================================================================
// Type Guards for deep-diff types
// ============================================================================

/**
 * Type guard for DiffNew (kind: "N") - entity exists in truth but not in merged.
 * Indicates something was added in the truth that the merge didn't produce.
 */
function isDiffNew(d: Diff<unknown>): d is DiffNew<unknown> {
  return d.kind === 'N';
}

/**
 * Type guard for DiffDeleted (kind: "D") - entity exists in merged but not in truth.
 * Indicates something extra in merged that shouldn't be there.
 */
function isDiffDeleted(d: Diff<unknown>): d is DiffDeleted<unknown> {
  return d.kind === 'D';
}

/**
 * Type guard for DiffEdit (kind: "E") - entity exists in both but values differ.
 * Indicates a field value mismatch between merged and truth.
 */
function isDiffEdit(d: Diff<unknown>): d is DiffEdit<unknown> {
  return d.kind === 'E';
}

/**
 * Type guard for DiffArray (kind: "A") - array-specific change at an index.
 * Indicates an element-level change within an array.
 */
function isDiffArray(d: Diff<unknown>): d is DiffArray<unknown> {
  return d.kind === 'A';
}

/**
 * Logger interface matching FastMCP's context log
 */
interface ContextLog {
  debug: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
}

/**
 * Result of a drift check
 */
export interface DriftCheckResult {
  /** Number of differences found */
  differenceCount: number;
  /** Summary of differences by category */
  differenceSummary: Record<string, number>;
  /** The raw differences (for debugging) */
  differences: Diff<unknown>[];
  /** Whether any drift was detected */
  hasDrift: boolean;
  /** Server knowledge from merged budget */
  mergedServerKnowledge: number;
  /** Whether the server knowledge values differ (external changes may have occurred) */
  serverKnowledgeMismatch: boolean;
  /** Server knowledge from truth budget */
  truthServerKnowledge: number;
}

/**
 * State for tracking drift check frequency per budget.
 * Each budget tracks its own evaluation count and last drift check time
 * to avoid race conditions when multiple budgets are accessed.
 */
interface DriftCheckState {
  /**
   * Count of how many times shouldPerformDriftCheck() has been called for this budget.
   * This is NOT a count of actual syncs - it tracks how many times we've evaluated
   * whether to perform a drift check. A drift check is triggered when this count
   * reaches a multiple of the configured interval (YNAB_DRIFT_CHECK_INTERVAL_SYNCS).
   */
  checkEvaluationCount: number;
  lastDriftCheckAt: Date | null;
}

/**
 * Per-budget drift check state.
 * Using a Map keyed by budgetId ensures each budget tracks its own
 * drift check frequency independently, preventing race conditions
 * when multiple budgets are synced concurrently.
 */
const driftCheckStateByBudget = new Map<string, DriftCheckState>();

/**
 * Get or create drift check state for a specific budget.
 */
function getDriftCheckState(budgetId: string): DriftCheckState {
  let state = driftCheckStateByBudget.get(budgetId);
  if (state === undefined) {
    state = {
      checkEvaluationCount: 0,
      lastDriftCheckAt: null,
    };
    driftCheckStateByBudget.set(budgetId, state);
  }
  return state;
}

// ============================================================================
// Environment Variable Helpers
// ============================================================================

/**
 * Check if drift detection is enabled.
 *
 * Default: true (enabled)
 * Set YNAB_DRIFT_DETECTION=false to disable
 */
export function isDriftDetectionEnabled(): boolean {
  const value = process.env['YNAB_DRIFT_DETECTION'];
  // Default to true if not set
  if (value === undefined || value === '') {
    return true;
  }
  // Explicitly disabled
  return value !== 'false' && value !== '0';
}

/**
 * Check if "always full sync" mode is enabled.
 * When enabled, skip delta queries entirely and always fetch the full budget.
 *
 * Default: false (use delta sync for performance)
 * Set YNAB_ALWAYS_FULL_SYNC=true to enable
 */
export function isAlwaysFullSyncEnabled(): boolean {
  const value = process.env['YNAB_ALWAYS_FULL_SYNC'];
  return value === 'true' || value === '1';
}

/**
 * Get the drift check interval in number of syncs.
 * In production, we don't need to check every sync - periodic checks are sufficient.
 *
 * Default: 1 (check every sync - good for development/alpha)
 * Set YNAB_DRIFT_CHECK_INTERVAL_SYNCS to change
 */
export function getDriftCheckIntervalSyncs(): number {
  const value = process.env['YNAB_DRIFT_CHECK_INTERVAL_SYNCS'];
  if (value === undefined || value === '') {
    return 1; // Default: check every sync
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

/**
 * Get the drift check interval in minutes.
 * Alternative to sync-count-based checking.
 *
 * Default: 0 (disabled - use sync count instead)
 * Set YNAB_DRIFT_CHECK_INTERVAL_MINUTES to enable time-based checking
 */
export function getDriftCheckIntervalMinutes(): number {
  const value = process.env['YNAB_DRIFT_CHECK_INTERVAL_MINUTES'];
  if (value === undefined || value === '') {
    return 0; // Disabled by default
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

// ============================================================================
// Drift Check Logic
// ============================================================================

/**
 * Determine if a drift check should be performed based on frequency settings.
 * Call this before performing a drift check to respect rate limiting.
 *
 * @param budgetId - The budget ID to check drift state for
 * @returns true if a drift check should be performed
 */
export function shouldPerformDriftCheck(budgetId: string): boolean {
  if (!isDriftDetectionEnabled()) {
    return false;
  }

  // Always full sync mode means we don't need drift checks
  // (we're always getting the full budget anyway)
  if (isAlwaysFullSyncEnabled()) {
    return false;
  }

  // Get per-budget state
  const state = getDriftCheckState(budgetId);

  // Increment the evaluation count for this budget.
  // This tracks how many times we've checked whether to perform a drift check,
  // NOT how many actual syncs have occurred. A drift check is triggered when
  // this count reaches a multiple of the configured interval.
  state.checkEvaluationCount++;

  // Check if we've reached the interval threshold
  const checkInterval = getDriftCheckIntervalSyncs();
  if (state.checkEvaluationCount % checkInterval === 0) {
    return true;
  }

  // Check time interval (if configured)
  const minuteInterval = getDriftCheckIntervalMinutes();
  if (minuteInterval > 0 && state.lastDriftCheckAt !== null) {
    const elapsed = Date.now() - state.lastDriftCheckAt.getTime();
    const elapsedMinutes = elapsed / (1000 * 60);
    if (elapsedMinutes >= minuteInterval) {
      return true;
    }
  }

  return false;
}

/**
 * Record that a drift check was performed for a specific budget.
 * Call this after completing a drift check.
 *
 * @param budgetId - The budget ID to record the drift check for
 */
export function recordDriftCheck(budgetId: string): void {
  const state = getDriftCheckState(budgetId);
  state.lastDriftCheckAt = new Date();
}

/**
 * Reset drift check state (useful for testing).
 *
 * @param budgetId - Optional budget ID to reset. If not provided, resets all budgets.
 */
export function resetDriftCheckState(budgetId?: string): void {
  if (budgetId !== undefined) {
    // Reset specific budget
    driftCheckStateByBudget.delete(budgetId);
  } else {
    // Reset all budgets
    driftCheckStateByBudget.clear();
  }
}

/**
 * Sort an array of entities by their `id` field for consistent comparison.
 * This ensures that arrays are compared by content, not by position.
 */
function sortById<T extends {id: string}>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Prepare months for comparison by sorting by `month` key and sorting
 * nested `categories` arrays by `id`.
 */
function prepareMonths(months: LocalBudget['months']): LocalBudget['months'] {
  return [...months]
    .map((m) => ({
      ...m,
      categories: sortById(m.categories),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Prepare a LocalBudget for comparison by converting Maps to plain objects,
 * removing non-comparable fields, and normalizing array order.
 *
 * Arrays are sorted by ID to ensure comparison is by content, not position.
 * This is necessary because delta sync may return entities in a different
 * order than a full fetch.
 *
 * @param budget - The LocalBudget to prepare
 * @returns A plain object suitable for deep comparison
 */
function prepareForComparison(budget: LocalBudget): Record<string, unknown> {
  // Only compare the data arrays, not the lookup maps or metadata
  // Sort all arrays by ID to compare by content, not position
  return {
    accounts: sortById(budget.accounts),
    budgetId: budget.budgetId,
    budgetName: budget.budgetName,
    categories: sortById(budget.categories),
    categoryGroups: sortById(budget.categoryGroups),
    currencyFormat: budget.currencyFormat,
    months: prepareMonths(budget.months),
    payeeLocations: sortById(budget.payeeLocations),
    payees: sortById(budget.payees),
    scheduledSubtransactions: sortById(budget.scheduledSubtransactions),
    scheduledTransactions: sortById(budget.scheduledTransactions),
    // Skip serverKnowledge as it will differ
    subtransactions: sortById(budget.subtransactions),
    transactions: sortById(budget.transactions),
  };
}

/**
 * Get a human-readable path from a diff result.
 */
function formatDiffPath(diffResult: Diff<unknown>): string {
  if (diffResult.path === undefined) {
    return '(root)';
  }
  return diffResult.path.map((p) => String(p)).join('.');
}

/**
 * Summarize differences by top-level category.
 */
function summarizeDifferences(
  differences: Diff<unknown>[],
): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const d of differences) {
    // d.path is typed as any[] | undefined in deep-diff, so we handle it safely
    const pathArray = d.path as (string | number)[] | undefined;
    const firstPath = pathArray?.[0];
    const category = firstPath !== undefined ? String(firstPath) : 'unknown';
    summary[category] = (summary[category] ?? 0) + 1;
  }

  return summary;
}

/**
 * Compare a merged LocalBudget against a "truth" budget from a full fetch.
 *
 * @param mergedBudget - The budget built from base + delta merges
 * @param truthBudget - The budget from a fresh full fetch (source of truth)
 * @returns Detailed comparison result
 */
export function checkForDrift(
  mergedBudget: LocalBudget,
  truthBudget: LocalBudget,
): DriftCheckResult {
  const serverKnowledgeMismatch =
    mergedBudget.serverKnowledge !== truthBudget.serverKnowledge;

  // Prepare budgets for comparison (strip Maps and metadata)
  const mergedData = prepareForComparison(mergedBudget);
  const truthData = prepareForComparison(truthBudget);

  // Perform deep comparison
  const differences = deepDiff(mergedData, truthData) ?? [];

  return {
    differenceCount: differences.length,
    differenceSummary: summarizeDifferences(differences),
    differences,
    hasDrift: differences.length > 0,
    mergedServerKnowledge: mergedBudget.serverKnowledge,
    serverKnowledgeMismatch,
    truthServerKnowledge: truthBudget.serverKnowledge,
  };
}

/**
 * Log drift check results appropriately based on outcome.
 *
 * @param result - The drift check result
 * @param budgetId - The budget ID (for logging context)
 * @param log - The logger to use
 */
export function logDriftCheckResult(
  result: DriftCheckResult,
  budgetId: string,
  log: ContextLog,
): void {
  // Log server knowledge mismatch warning
  if (result.serverKnowledgeMismatch) {
    log.warn('⚠️ Server knowledge mismatch during drift check', {
      budgetId,
      mergedServerKnowledge: result.mergedServerKnowledge,
      note: 'External changes likely occurred between queries. Differences may be expected.',
      truthServerKnowledge: result.truthServerKnowledge,
    });
  }

  if (!result.hasDrift) {
    // Success! No drift detected
    log.info('✅ Drift check passed - merge logic validated', {
      budgetId,
      serverKnowledge: {
        merged: result.mergedServerKnowledge,
        truth: result.truthServerKnowledge,
      },
    });
    return;
  }

  // Drift detected - log detailed warning
  log.error('🚨 DRIFT DETECTED - merge logic produced different result', {
    budgetId,
    differenceCount: result.differenceCount,
    differenceSummary: result.differenceSummary,
  });

  // Log first few differences in detail (limit to avoid log spam)
  const maxDetailsToLog = 5;
  const differencesToLog = result.differences.slice(0, maxDetailsToLog);

  for (let i = 0; i < differencesToLog.length; i++) {
    const d = differencesToLog[i];
    if (d === undefined) continue;

    const path = formatDiffPath(d);

    // Use type guards for proper type narrowing
    if (isDiffNew(d)) {
      // New in truth (missing in merged)
      log.error(`  [${i + 1}] MISSING: ${path}`, {
        truthValue: d.rhs,
      });
    } else if (isDiffDeleted(d)) {
      // Deleted in truth (extra in merged)
      log.error(`  [${i + 1}] EXTRA: ${path}`, {
        mergedValue: d.lhs,
      });
    } else if (isDiffEdit(d)) {
      // Edited (value differs)
      log.error(`  [${i + 1}] DIFFERS: ${path}`, {
        merged: d.lhs,
        truth: d.rhs,
      });
    } else if (isDiffArray(d)) {
      // Array change
      log.error(`  [${i + 1}] ARRAY CHANGE: ${path}[${d.index}]`, {
        item: d.item,
      });
    }
  }

  if (result.differenceCount > maxDetailsToLog) {
    log.error(
      `  ... and ${result.differenceCount - maxDetailsToLog} more differences`,
    );
  }

  log.info('🔧 Self-healing: Replacing local budget with full fetch result');
}
