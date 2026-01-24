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

// Track whether initial backup has been performed this session
let initialBackupDone = false;

// Track if initial backup is currently in progress (prevent concurrent runs)
let initialBackupInProgress = false;

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
 * Reset the initial backup flag (for testing)
 */
export function resetInitialBackupFlag(): void {
  initialBackupDone = false;
  initialBackupInProgress = false;
}

/**
 * Check if initial backup has been done
 */
export function hasInitialBackupBeenDone(): boolean {
  return initialBackupDone;
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
 * Perform initial backup if not already done this session
 * Called automatically on first tool invocation
 */
export async function performInitialBackupIfNeeded(
  log: ContextLog,
): Promise<void> {
  // Skip if already done or disabled
  if (initialBackupDone || isAutoBackupDisabled()) {
    log.debug('Skipping initial backup', {
      alreadyDone: initialBackupDone,
      disabled: isAutoBackupDisabled(),
    });
    return;
  }

  // Prevent concurrent backup attempts
  if (initialBackupInProgress) {
    log.debug('Initial backup already in progress, skipping');
    return;
  }

  initialBackupInProgress = true;

  try {
    log.info('Performing automatic backup on first tool call...');
    const paths = await backupAllBudgets();
    initialBackupDone = true;

    for (const path of paths) {
      log.info('Backup created', {file_path: path});
    }
    log.info('Automatic backup complete', {budget_count: paths.length});
  } catch (error) {
    // Log but don't fail the tool call - backup is a safety feature
    log.warn('Automatic backup failed (continuing with tool execution)', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    initialBackupInProgress = false;
  }
}
