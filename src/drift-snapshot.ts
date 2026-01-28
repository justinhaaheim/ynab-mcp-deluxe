/**
 * Drift Snapshot Collection
 *
 * Saves drift detection artifacts for later analysis when drift is detected.
 * This allows passive collection of real-world drift cases while development
 * continues with full sync (guaranteed correct).
 */

import type {DriftCheckResult} from './drift-detection.js';
import type {LocalBudget} from './types.js';
import type {BudgetDetail} from 'ynab';

import * as fs from 'node:fs/promises';
import {homedir} from 'node:os';
import * as path from 'node:path';

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
 * Get the drift sample rate (1 in N drift occurrences are saved).
 * Default: 1 (save all drift occurrences)
 * Set YNAB_DRIFT_SAMPLE_RATE to change.
 */
export function getDriftSampleRate(): number {
  const value = process.env['YNAB_DRIFT_SAMPLE_RATE'];
  if (value === undefined || value === '') {
    return 1; // Default: save all
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

// Module-level counter for sample rate
let driftOccurrenceCount = 0;

/**
 * Check if this drift occurrence should be sampled (saved).
 * Increments internal counter and checks against sample rate.
 */
export function shouldSampleDrift(): boolean {
  driftOccurrenceCount++;
  const sampleRate = getDriftSampleRate();
  return driftOccurrenceCount % sampleRate === 0;
}

/**
 * Reset drift occurrence counter (useful for testing).
 */
export function resetDriftOccurrenceCount(): void {
  driftOccurrenceCount = 0;
}

/**
 * Get the drift snapshots directory.
 * ~/.config/ynab-mcp-deluxe/drift-snapshots/
 */
export function getDriftSnapshotsDir(): string {
  return path.join(homedir(), '.config', 'ynab-mcp-deluxe', 'drift-snapshots');
}

/**
 * Artifacts to save when drift is detected.
 */
export interface DriftSnapshotArtifacts {
  /** The budget ID */
  budgetId: string;
  /** The delta API response */
  deltaResponse: BudgetDetail;
  /** The drift check result with differences */
  driftResult: DriftCheckResult;
  /** The full API response (truth) */
  fullResponse: BudgetDetail;
  /** The merged budget (from applying delta to previous) */
  mergedBudget: LocalBudget;
  /** The previous full budget (base for merge) */
  previousFullResponse: BudgetDetail;
  /** Server knowledge values */
  serverKnowledge: {
    afterDelta: number;
    afterFull: number;
    previous: number;
  };
}

/**
 * Serialize a LocalBudget for saving (convert Maps to objects).
 */
function serializeLocalBudget(budget: LocalBudget): Record<string, unknown> {
  return {
    accounts: budget.accounts,
    budgetId: budget.budgetId,
    budgetName: budget.budgetName,
    categories: budget.categories,
    categoryGroups: budget.categoryGroups,
    currencyFormat: budget.currencyFormat,
    lastSyncedAt: budget.lastSyncedAt.toISOString(),
    months: budget.months,
    needsSync: budget.needsSync,
    payeeLocations: budget.payeeLocations,
    payees: budget.payees,
    scheduledSubtransactions: budget.scheduledSubtransactions,
    scheduledTransactions: budget.scheduledTransactions,
    serverKnowledge: budget.serverKnowledge,
    subtransactions: budget.subtransactions,
    transactions: budget.transactions,
  };
}

/**
 * Save drift snapshot artifacts to disk.
 *
 * Creates a timestamped directory with all artifacts for later analysis.
 *
 * @param artifacts - The drift snapshot artifacts to save
 * @param log - Logger for debug output
 * @returns The path to the saved snapshot directory
 */
export async function saveDriftSnapshot(
  artifacts: DriftSnapshotArtifacts,
  log: ContextLog,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join(
    getDriftSnapshotsDir(),
    `${timestamp}_${artifacts.budgetId}`,
  );

  try {
    // Ensure directory exists
    await fs.mkdir(snapshotDir, {recursive: true});

    // Prepare summary
    const summary = {
      budgetId: artifacts.budgetId,
      differenceCount: artifacts.driftResult.differenceCount,
      differenceSummary: artifacts.driftResult.differenceSummary,
      savedAt: new Date().toISOString(),
      serverKnowledge: artifacts.serverKnowledge,
      serverKnowledgeMismatch: artifacts.driftResult.serverKnowledgeMismatch,
    };

    // Save all artifacts in parallel
    await Promise.all([
      fs.writeFile(
        path.join(snapshotDir, 'summary.json'),
        JSON.stringify(summary, null, 2),
      ),
      fs.writeFile(
        path.join(snapshotDir, 'previous-full.json'),
        JSON.stringify(artifacts.previousFullResponse, null, 2),
      ),
      fs.writeFile(
        path.join(snapshotDir, 'delta-response.json'),
        JSON.stringify(artifacts.deltaResponse, null, 2),
      ),
      fs.writeFile(
        path.join(snapshotDir, 'merged-budget.json'),
        JSON.stringify(serializeLocalBudget(artifacts.mergedBudget), null, 2),
      ),
      fs.writeFile(
        path.join(snapshotDir, 'full-response.json'),
        JSON.stringify(artifacts.fullResponse, null, 2),
      ),
      fs.writeFile(
        path.join(snapshotDir, 'differences.json'),
        JSON.stringify(artifacts.driftResult.differences, null, 2),
      ),
    ]);

    log.info('💾 Drift snapshot saved for later analysis', {
      differenceCount: artifacts.driftResult.differenceCount,
      path: snapshotDir,
    });

    return snapshotDir;
  } catch (error) {
    log.error('Failed to save drift snapshot', {
      error: error instanceof Error ? error.message : String(error),
      snapshotDir,
    });
    throw error;
  }
}
