/**
 * Type definitions for the YNAB MCP server
 */

/**
 * Enriched subtransaction with resolved names
 */
export interface EnrichedSubTransaction {
  amount: number;
  // Milliunits
  amount_currency: number;
  category_group_name: string | null;
  category_id: string | null;
  category_name: string | null;
  id: string;
  // Currency amount
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
  transaction_id: string;
  transfer_account_id: string | null;
}

/**
 * Enriched transaction with both IDs (for API operations) and resolved names (for LLM reasoning)
 */
export interface EnrichedTransaction {
  // Identifiers (preserved for API operations)
  account_id: string;
  // Resolved names (for LLM reasoning)
  account_name: string;
  // Milliunits (integer, source of truth)
  amount: number;
  // Currency amount (e.g., -45.99 for USD)
  amount_currency: number;
  approved: boolean;
  category_group_name: string | null;
  category_id: string | null;
  category_name: string | null;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  // Transaction details - ISO format "2025-01-15"
  date: string;
  flag_color: string | null;
  id: string;
  // Import metadata (useful for pattern matching)
  import_id: string | null;
  import_payee_name: string | null;
  import_payee_name_original: string | null;
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
  // Subtransactions (for split transactions)
  subtransactions: EnrichedSubTransaction[];
  transfer_account_id: string | null;
}

/**
 * Category with group information
 */
export interface EnrichedCategory {
  activity?: number;
  balance?: number;
  budgeted?: number;
  category_group_id: string;
  category_group_name: string;
  deleted: boolean;
  hidden: boolean;
  id: string;
  name: string;
}

/**
 * Account with currency amounts
 */
export interface EnrichedAccount {
  balance: number;
  // Milliunits
  balance_currency: number;
  closed: boolean;
  id: string;
  name: string;
  on_budget: boolean;
  type: string; // Currency amount
}

/**
 * Payee information
 */
export interface EnrichedPayee {
  id: string;
  name: string;
  transfer_account_id: string | null;
}

/**
 * Budget summary with currency format
 */
export interface EnrichedBudgetSummary {
  currency_format: {
    currency_symbol: string;
    decimal_digits: number;
    decimal_separator: string;
    example_format: string;
    iso_code: string;
    symbol_first: boolean;
  } | null;
  first_month: string | null;
  id: string;
  last_modified_on: string | null;
  last_month: string | null;
  name: string;
}

/**
 * Category distribution entry for payee history
 */
export interface CategoryDistribution {
  category_group_name: string | null;
  category_name: string | null;
  count: number;
  percentage: number;
}

/**
 * Payee history response
 */
export interface PayeeHistoryResponse {
  category_distribution: CategoryDistribution[];
  payee_search: string;
  total_matches: number;
  transactions: EnrichedTransaction[];
}

/**
 * Update transaction result
 */
export interface UpdateTransactionsResult {
  failed: {error: string; id: string}[];
  updated: EnrichedTransaction[];
}

/**
 * Category group with categories (for get_categories response)
 */
export interface CategoryGroupResponse {
  categories: {
    hidden: boolean;
    id: string;
    name: string;
  }[];
  group_id: string;
  group_name: string;
}

/**
 * Budget selector - can specify by name or id
 */
export interface BudgetSelector {
  id?: string;
  name?: string;
}

/**
 * Account selector - can specify by name or id
 */
export interface AccountSelector {
  id?: string;
  name?: string;
}

/**
 * Transaction status filter
 */
export type TransactionStatus = 'uncategorized' | 'unapproved' | 'all';

/**
 * Sort options for transactions
 */
export type TransactionSortBy =
  | 'newest'
  | 'oldest'
  | 'amount_desc'
  | 'amount_asc';

/**
 * Transaction update payload
 */
export interface TransactionUpdate {
  approved?: boolean;
  category_id?: string;
  flag_color?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | null;
  id: string;
  memo?: string;
}

/**
 * Category selector - can specify by name or id
 */
export interface CategorySelector {
  id?: string;
  name?: string;
}

/**
 * Payee selector - can specify by name or id
 */
export interface PayeeSelector {
  id?: string;
  name?: string;
}

/**
 * Enriched scheduled transaction
 */
export interface EnrichedScheduledTransaction {
  account_id: string;
  account_name: string;
  amount: number;
  amount_currency: number;
  category_id: string | null;
  category_name: string | null;
  date_first: string;
  date_next: string;
  flag_color: string | null;
  frequency: string;
  id: string;
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
}

/**
 * Month summary
 */
export interface EnrichedMonthSummary {
  activity: number;
  activity_currency: number;
  age_of_money: number | null;
  budgeted: number;
  budgeted_currency: number;
  income: number;
  income_currency: number;
  month: string;
  note: string | null;
  to_be_budgeted: number;
  to_be_budgeted_currency: number;
}

/**
 * Budget month detail with categories
 */
export interface EnrichedBudgetMonthDetail {
  activity: number;
  activity_currency: number;
  age_of_money: number | null;
  budgeted: number;
  budgeted_currency: number;
  categories: EnrichedMonthCategory[];
  income: number;
  income_currency: number;
  month: string;
  note: string | null;
  to_be_budgeted: number;
  to_be_budgeted_currency: number;
}

/**
 * Category with month-specific budget info
 */
export interface EnrichedMonthCategory {
  activity: number;
  activity_currency: number;
  balance: number;
  balance_currency: number;
  budgeted: number;
  budgeted_currency: number;
  category_group_id: string;
  category_group_name: string;
  goal_percentage_complete: number | null;
  goal_target: number | null;
  goal_type: string | null;
  hidden: boolean;
  id: string;
  name: string;
}

/**
 * Create transaction input
 */
export interface CreateTransactionInput {
  account_id: string;
  amount: number;
  approved?: boolean;
  category_id?: string;
  cleared?: boolean;
  date: string;
  flag_color?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
  memo?: string;
  payee_id?: string;
  payee_name?: string;
}

/**
 * Journal entry for change tracking
 */
export interface JournalEntry {
  after: unknown;
  before: unknown;
  budget: {
    id: string;
    name: string;
  };
  changes?: Record<string, {from: unknown; to: unknown}>;
  id: string;
  metadata?: {
    affected_count?: number;
    affected_ids?: string[];
    summary?: string;
  };
  operation: string;
  timestamp: string;
}
