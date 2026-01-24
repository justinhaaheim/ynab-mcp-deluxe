/**
 * Budget backup utilities
 */

import type {BudgetBackup} from './types.js';
import type {SerializableValue} from 'fastmcp';

import {mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

import {ynabClient} from './ynab-client.js';

// Server version for backup metadata
const SERVER_VERSION = '1.0.0';

// Backup interval: 24 hours in milliseconds
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Track last backup time per budget (budget ID → timestamp)
// Only persists for the lifetime of this server instance
const lastBackupByBudget = new Map<string, Date>();

// Track which budgets currently have a backup in progress (prevent concurrent runs)
const backupInProgressByBudget = new Set<string>();

/**
 * Logger interface matching FastMCP's context log
 */
interface ContextLog {
  debug: (message: string, data?: SerializableValue) => void;
  error: (message: string, data?: SerializableValue) => void;
  info: (message: string, data?: SerializableValue) => void;
  warn: (message: string, data?: SerializableValue) => void;
}

/**
 * Get the backup directory path
 * ~/.config/ynab-mcp-deluxe/backups/
 */
export function getBackupDir(): string {
  return join(homedir(), '.config', 'ynab-mcp-deluxe', 'backups');
}

/**
 * Check if automatic backup is disabled
 * Backup is enabled by default, set YNAB_AUTO_BACKUP=false to disable
 */
export function isAutoBackupDisabled(): boolean {
  const value = process.env['YNAB_AUTO_BACKUP'];
  return value === 'false' || value === '0';
}

/**
 * Reset backup tracking state (for testing)
 */
export function resetBackupState(): void {
  lastBackupByBudget.clear();
  backupInProgressByBudget.clear();
}

/**
 * Get the last backup time for a budget (for testing)
 */
export function getLastBackupTime(budgetId: string): Date | undefined {
  return lastBackupByBudget.get(budgetId);
}

/**
 * Check if a budget needs backup (first time or 24+ hours since last)
 */
export function needsBackup(budgetId: string): boolean {
  const lastBackup = lastBackupByBudget.get(budgetId);
  if (lastBackup === undefined) {
    return true; // Never backed up this session
  }
  const elapsed = Date.now() - lastBackup.getTime();
  return elapsed >= BACKUP_INTERVAL_MS;
}

/**
 * Generate backup filename with timestamp and budget ID
 * Format: YYYY-MM-DD_HH-mm-ss_ynab-budget-[id]_backup.json
 */
export function generateBackupFilename(budgetId: string): string {
  const now = new Date();
  // Format: 2026-01-23_06-15-40
  const timestamp = now
    .toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .replace(/\.\d+Z$/, '');

  return `${timestamp}_ynab-budget-${budgetId}_backup.json`;
}

/**
 * Ensure the backup directory exists
 */
export async function ensureBackupDir(): Promise<void> {
  const dir = getBackupDir();
  await mkdir(dir, {recursive: true});
}

/**
 * Backup a single budget to disk
 * @returns The full path to the backup file
 */
export async function backupBudget(budgetId: string): Promise<string> {
  // Get budget info for metadata
  const budgetInfo = await ynabClient.getBudgetInfo(budgetId);

  // Get raw budget data
  const {budget, server_knowledge} =
    await ynabClient.getBudgetByIdRaw(budgetId);

  // Construct backup object
  const backup: BudgetBackup = {
    backup_metadata: {
      backup_timestamp: new Date().toISOString(),
      budget_id: budgetId,
      budget_name: budgetInfo.name,
      server_knowledge,
      ynab_mcp_server_version: SERVER_VERSION,
    },
    budget,
  };

  // Ensure directory exists
  await ensureBackupDir();

  // Write backup file
  const filename = generateBackupFilename(budgetId);
  const filePath = join(getBackupDir(), filename);
  await writeFile(filePath, JSON.stringify(backup, null, 2), 'utf-8');

  return filePath;
}

/**
 * Backup all budgets
 * @returns Array of backup file paths
 */
export async function backupAllBudgets(): Promise<string[]> {
  const budgets = await ynabClient.getBudgets();
  const paths: string[] = [];

  for (const budget of budgets) {
    const path = await backupBudget(budget.id);
    paths.push(path);
  }

  return paths;
}

/**
 * Perform automatic backup for a specific budget if needed.
 * Backs up if:
 * - This budget hasn't been backed up this session, OR
 * - It's been 24+ hours since the last backup of this budget
 *
 * Called automatically from tools that operate on a specific budget.
 */
export async function performAutoBackupIfNeeded(
  budgetId: string,
  log: ContextLog,
): Promise<void> {
  // Skip if disabled
  if (isAutoBackupDisabled()) {
    log.debug('Auto backup disabled', {budget_id: budgetId});
    return;
  }

  // Check if backup is needed
  if (!needsBackup(budgetId)) {
    const lastBackup = lastBackupByBudget.get(budgetId);
    log.debug('Backup not needed for budget', {
      budget_id: budgetId,
      last_backup: lastBackup?.toISOString(),
    });
    return;
  }

  // Prevent concurrent backup attempts for the same budget
  if (backupInProgressByBudget.has(budgetId)) {
    log.debug('Backup already in progress for budget', {budget_id: budgetId});
    return;
  }

  backupInProgressByBudget.add(budgetId);

  try {
    const lastBackup = lastBackupByBudget.get(budgetId);
    const reason =
      lastBackup !== undefined ? '24+ hours since last backup' : 'first access';
    log.info(`Performing automatic backup (${reason})...`, {
      budget_id: budgetId,
    });

    const startTime = performance.now();
    const filePath = await backupBudget(budgetId);
    const durationMs = Math.round(performance.now() - startTime);

    lastBackupByBudget.set(budgetId, new Date());

    log.info('Automatic backup complete', {
      budget_id: budgetId,
      duration_ms: durationMs,
      file_path: filePath,
    });
  } catch (error) {
    // Log but don't fail the tool call - backup is a safety feature
    log.warn('Automatic backup failed (continuing with tool execution)', {
      budget_id: budgetId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    backupInProgressByBudget.delete(budgetId);
  }
}
