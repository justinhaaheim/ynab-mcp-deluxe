/**
 * Budget backup utilities
 */

import type {BudgetBackup} from './types.js';

import {mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

import {ynabClient} from './ynab-client.js';

// Server version for backup metadata
const SERVER_VERSION = '1.0.0';

/**
 * Get the backup directory path
 * ~/.config/ynab-mcp-deluxe/backups/
 */
export function getBackupDir(): string {
  return join(homedir(), '.config', 'ynab-mcp-deluxe', 'backups');
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
