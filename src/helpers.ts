/**
 * Helper functions for the YNAB MCP server
 */

import type {
  CategoryDistribution,
  EnrichedTransaction,
  TransactionSortBy,
} from './types.js';

import jmespath from '@metrichor/jmespath';

/**
 * Apply a JMESPath query to data
 * @throws Error with helpful message if query is invalid
 */
export function applyJMESPath<T>(data: T, query: string): unknown {
  try {
    // Cast through unknown for type safety with jmespath
    const jsonData = data as unknown;
    return jmespath.search(
      jsonData as Parameters<typeof jmespath.search>[0],
      query,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Invalid JMESPath expression: ${message}. Expression: '${query}'.`,
    );
  }
}

/**
 * Sort transactions by the specified criteria
 */
export function sortTransactions(
  transactions: EnrichedTransaction[],
  sortBy: TransactionSortBy,
): EnrichedTransaction[] {
  const sorted = [...transactions];

  switch (sortBy) {
    case 'newest':
      sorted.sort((a, b) => b.date.localeCompare(a.date));
      break;
    case 'oldest':
      sorted.sort((a, b) => a.date.localeCompare(b.date));
      break;
    case 'amount_desc':
      // Largest outflows first (most negative first)
      sorted.sort((a, b) => a.amount - b.amount);
      break;
    case 'amount_asc':
      // Largest inflows first (most positive first)
      sorted.sort((a, b) => b.amount - a.amount);
      break;
  }

  return sorted;
}

/**
 * Filter transactions by payee name (case-insensitive partial match)
 */
export function filterByPayee(
  transactions: EnrichedTransaction[],
  payeeContains: string,
): EnrichedTransaction[] {
  const searchLower = payeeContains.toLowerCase();
  return transactions.filter((tx) => {
    const payeeName = tx.payee_name?.toLowerCase() ?? '';
    const importPayeeName = tx.import_payee_name?.toLowerCase() ?? '';
    const importPayeeNameOriginal =
      tx.import_payee_name_original?.toLowerCase() ?? '';
    return (
      payeeName.includes(searchLower) ||
      importPayeeName.includes(searchLower) ||
      importPayeeNameOriginal.includes(searchLower)
    );
  });
}

/**
 * Filter transactions by date range
 */
export function filterByDateRange(
  transactions: EnrichedTransaction[],
  sinceDate?: string,
  untilDate?: string,
): EnrichedTransaction[] {
  return transactions.filter((tx) => {
    if (sinceDate !== undefined && sinceDate !== '' && tx.date < sinceDate)
      return false;
    if (untilDate !== undefined && untilDate !== '' && tx.date > untilDate)
      return false;
    return true;
  });
}

/**
 * Filter transactions by account ID
 */
export function filterByAccount(
  transactions: EnrichedTransaction[],
  accountId: string,
): EnrichedTransaction[] {
  return transactions.filter((tx) => tx.account_id === accountId);
}

/**
 * Calculate category distribution for a set of transactions
 */
export function calculateCategoryDistribution(
  transactions: EnrichedTransaction[],
): CategoryDistribution[] {
  const counts = new Map<
    string,
    {count: number; groupName: string | null; name: string | null}
  >();

  for (const tx of transactions) {
    const key = tx.category_id ?? 'uncategorized';
    const existing = counts.get(key);
    if (existing !== undefined) {
      existing.count++;
    } else {
      counts.set(key, {
        count: 1,
        groupName: tx.category_group_name,
        name: tx.category_name,
      });
    }
  }

  const total = transactions.length;
  const distribution: CategoryDistribution[] = [];

  for (const {name, groupName, count} of counts.values()) {
    distribution.push({
      category_group_name: groupName,
      category_name: name,
      count,
      percentage: Math.round((count / total) * 1000) / 10, // One decimal place
    });
  }

  // Sort by count descending
  distribution.sort((a, b) => b.count - a.count);

  return distribution;
}

/**
 * Create an MCP error response
 */
export function createErrorResponse(message: string): {
  content: {text: string; type: 'text'}[];
  isError: true;
} {
  return {
    content: [{text: message, type: 'text'}],
    isError: true,
  };
}

/**
 * Validate a selector has exactly one of name or id
 */
export function validateSelector(
  selector: {id?: string; name?: string} | undefined,
  entityType: string,
): void {
  if (selector === undefined || selector === null) return;

  const hasName = selector.name !== undefined && selector.name !== '';
  const hasId = selector.id !== undefined && selector.id !== '';

  if (hasName && hasId) {
    throw new Error(
      `${entityType} selector must specify exactly one of: 'name' or 'id'.`,
    );
  }
}

/**
 * Check if a value looks like it might be a JMESPath query result
 * (i.e., it's been transformed by a projection)
 */
export function isTransformed(value: unknown): boolean {
  if (!Array.isArray(value)) return true;
  if (value.length === 0) return false;
  // If the first item doesn't have standard transaction fields, it's been transformed
  const first: unknown = value[0];
  if (typeof first !== 'object' || first === null) return true;
  return !('id' in first && 'date' in first && 'amount' in first);
}
