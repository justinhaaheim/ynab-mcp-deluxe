/**
 * Sync history persistence utilities.
 *
 * Every sync response is saved to disk, creating an automatic incremental backup trail.
 * This replaces the auto-backup functionality with continuous, granular backups.
 *
 * Directory structure:
 * ~/.config/ynab-mcp-deluxe/sync-history/[budgetId]/
 *   - 20260125T143022Z-full.json    # Initial sync
 *   - 20260125T153022Z-delta.json   # Delta sync
 *   - ...
 */

import type {SyncHistoryEntry, SyncType} from './types.js';
import type {BudgetDetail} from 'ynab';

import {mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

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
 * Get the base sync history directory path.
 * ~/.config/ynab-mcp-deluxe/sync-history/
 */
export function getSyncHistoryBaseDir(): string {
  return join(homedir(), '.config', 'ynab-mcp-deluxe', 'sync-history');
}

/**
 * Validate that a budgetId is safe to use in file paths.
 * YNAB budget IDs are UUIDs (alphanumeric with hyphens).
 * This prevents path traversal attacks with malicious budgetId values.
 *
 * @param budgetId - The budget ID to validate
 * @returns true if the budgetId is safe for use in paths
 */
export function isValidBudgetIdForPath(budgetId: string): boolean {
  // YNAB budget IDs are UUIDs: alphanumeric characters and hyphens only
  // Example: "12345678-1234-1234-1234-123456789abc"
  // Reject empty strings, path separators, dots, and other special characters
  return /^[a-zA-Z0-9-]+$/.test(budgetId) && budgetId.length > 0;
}

/**
 * Get the sync history directory for a specific budget.
 * ~/.config/ynab-mcp-deluxe/sync-history/[budgetId]/
 *
 * @param budgetId - The budget ID (must be a valid UUID format)
 * @throws Error if budgetId contains invalid characters (path traversal protection)
 */
export function getSyncHistoryDir(budgetId: string): string {
  if (!isValidBudgetIdForPath(budgetId)) {
    throw new Error(
      `Invalid budgetId for file path: "${budgetId}". Budget IDs must contain only alphanumeric characters and hyphens.`,
    );
  }
  return join(getSyncHistoryBaseDir(), budgetId);
}

/**
 * Ensure the sync history directory exists for a budget.
 * Creates the directory tree if it doesn't exist.
 */
export async function ensureSyncHistoryDir(budgetId: string): Promise<void> {
  const dir = getSyncHistoryDir(budgetId);
  await mkdir(dir, {recursive: true});
}

/**
 * Generate sync history filename with timestamp and sync type.
 * Format: YYYYMMDDTHHMMSSZ-[full|delta].json
 *
 * Uses compact ISO 8601 format for easy sorting and readability.
 * Example: 20260125T143022Z-full.json
 */
export function generateSyncFilename(syncType: SyncType): string {
  const now = new Date();
  // Format: 20260125T143022Z (compact ISO 8601 UTC)
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

  return `${timestamp}-${syncType}.json`;
}

/**
 * Persist a sync response to disk.
 *
 * This function is designed to be fail-safe: if the write fails,
 * it logs a warning but does not throw. The sync operation should
 * continue even if persistence fails.
 *
 * @param budgetId - The budget ID
 * @param syncType - 'full' or 'delta'
 * @param budget - The budget data from YNAB API
 * @param serverKnowledge - The server_knowledge from this sync
 * @param previousServerKnowledge - For delta syncs, the previous server_knowledge
 * @param log - Logger for debug/error output
 * @returns The file path if successful, null if failed
 */
export async function persistSyncResponse(
  budgetId: string,
  syncType: SyncType,
  budget: BudgetDetail,
  serverKnowledge: number,
  previousServerKnowledge: number | null,
  log: ContextLog,
): Promise<string | null> {
  const startTime = performance.now();

  try {
    // Ensure directory exists
    await ensureSyncHistoryDir(budgetId);

    // Build the sync history entry
    const entry: SyncHistoryEntry = {
      budget,
      previousServerKnowledge,
      serverKnowledge,
      syncType,
      syncedAt: new Date().toISOString(),
    };

    // Generate filename and path
    const filename = generateSyncFilename(syncType);
    const filePath = join(getSyncHistoryDir(budgetId), filename);

    // Write to disk
    await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');

    const durationMs = Math.round(performance.now() - startTime);
    log.debug('Sync history persisted', {
      budgetId,
      durationMs,
      filePath,
      serverKnowledge,
      syncType,
    });

    return filePath;
  } catch (error) {
    // Log warning but don't fail - persistence is a safety feature, not critical path
    const durationMs = Math.round(performance.now() - startTime);
    log.warn('Failed to persist sync history (continuing with sync)', {
      budgetId,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      syncType,
    });
    return null;
  }
}

/**
 * Result of clearing sync history
 */
export interface ClearSyncHistoryResult {
  /** Budget IDs that were cleared (or 'all' if no specific budget) */
  budgetsCleared: string[];
  /** Any errors encountered (non-fatal) */
  errors: string[];
  /** Number of files deleted */
  filesDeleted: number;
}

/**
 * Clear sync history for a specific budget or all budgets.
 *
 * @param budgetId - Optional budget ID to clear. If not provided, clears all budgets.
 * @param log - Logger for debug/error output
 * @returns Summary of the clear operation
 */
export async function clearSyncHistory(
  budgetId: string | null,
  log: ContextLog,
): Promise<ClearSyncHistoryResult> {
  const result: ClearSyncHistoryResult = {
    budgetsCleared: [],
    errors: [],
    filesDeleted: 0,
  };

  const baseDir = getSyncHistoryBaseDir();

  try {
    if (budgetId !== null) {
      // Clear specific budget
      const budgetDir = getSyncHistoryDir(budgetId);
      try {
        const files = await readdir(budgetDir);
        result.filesDeleted = files.length;
        await rm(budgetDir, {force: true, recursive: true});
        result.budgetsCleared.push(budgetId);
        log.info('Cleared sync history for budget', {
          budgetId,
          filesDeleted: result.filesDeleted,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Directory doesn't exist - nothing to clear
          log.info('No sync history to clear for budget', {budgetId});
        } else {
          throw error;
        }
      }
    } else {
      // Clear all budgets
      try {
        const budgetDirs = await readdir(baseDir);
        for (const dir of budgetDirs) {
          const budgetDir = getSyncHistoryDir(dir);
          try {
            const files = await readdir(budgetDir);
            result.filesDeleted += files.length;
            await rm(budgetDir, {force: true, recursive: true});
            result.budgetsCleared.push(dir);
          } catch (dirError) {
            result.errors.push(
              `Failed to clear ${dir}: ${dirError instanceof Error ? dirError.message : String(dirError)}`,
            );
          }
        }
        log.info('Cleared all sync history', {
          budgetsCleared: result.budgetsCleared.length,
          filesDeleted: result.filesDeleted,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Base directory doesn't exist - nothing to clear
          log.info('No sync history directory exists');
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    log.error('Failed to clear sync history', {budgetId, error: errorMessage});
  }

  return result;
}
