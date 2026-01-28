/**
 * Type definitions for the YNAB MCP server
 */

import type {
  Account,
  BudgetDetail,
  Category,
  CategoryGroup,
  CurrencyFormat,
  MonthDetail,
  Payee,
  PayeeLocation,
  ScheduledSubTransaction,
  ScheduledTransactionSummary,
  SubTransaction,
  TransactionClearedStatus,
  TransactionFlagColor,
  TransactionSummary,
} from 'ynab';

// ============================================================================
// SDK-Derived Types (Single Source of Truth)
// ============================================================================

/**
 * Cleared status derived from YNAB SDK.
 * DO NOT hardcode these values - always use this type.
 */
export type ClearedStatus = TransactionClearedStatus;

/**
 * Flag color derived from YNAB SDK.
 * The SDK includes "" (empty string) for "no flag". For input types
 * (create/update), use FlagColorInput which excludes the empty string.
 */
export type FlagColor = TransactionFlagColor;

/**
 * Flag color for input operations (create/update) - excludes the empty
 * string value that the SDK includes for "no flag".
 */
export type FlagColorInput = Exclude<TransactionFlagColor, ''>;

// ============================================================================
// Local Budget Types (for delta sync)
// ============================================================================

/**
 * Local replica of a YNAB budget with O(1) lookup maps.
 * This is NOT a cache - it's a local copy that we keep in sync with the server.
 */
export interface LocalBudget {
  // O(1) lookup maps (rebuilt after each sync)
  accountById: Map<string, Account>;
  accountByName: Map<string, Account>;

  // Budget data (from full budget endpoint - using SDK types directly)
  accounts: Account[];
  // Budget identity
  budgetId: string;
  budgetName: string;
  categories: Category[];
  // lowercase name → account
  categoryById: Map<string, Category>;
  categoryByName: Map<string, Category>;
  // lowercase name → category
  categoryGroupNameById: Map<string, string>;
  categoryGroups: CategoryGroup[];
  // For delta sync
  // Budget settings
  currencyFormat: CurrencyFormat | null;
  // Sync metadata
  lastSyncedAt: Date;

  months: MonthDetail[];
  needsSync: boolean;
  payeeById: Map<string, Payee>;
  payeeLocations: PayeeLocation[];
  payees: Payee[];
  scheduledSubtransactions: ScheduledSubTransaction[];
  // O(1) lookup: scheduled_transaction_id → scheduled subtransactions[]
  scheduledSubtransactionsByScheduledTransactionId: Map<
    string,
    ScheduledSubTransaction[]
  >;

  scheduledTransactions: ScheduledTransactionSummary[];
  // True after write operations
  serverKnowledge: number;
  subtransactions: SubTransaction[];
  // O(1) lookup: transaction_id → subtransactions[]
  subtransactionsByTransactionId: Map<string, SubTransaction[]>;

  transactions: TransactionSummary[];
}

/**
 * Sync type for tracking what kind of sync was performed
 */
export type SyncType = 'full' | 'delta';

/**
 * Options for getLocalBudgetWithSync()
 */
export interface GetLocalBudgetOptions {
  /**
   * Force a sync operation:
   * - 'full': Do a complete re-fetch (useful for sanity checks, suspected drift)
   * - 'delta': Force delta sync even if interval hasn't passed
   * - undefined: Let sync policy decide
   */
  forceSync?: 'full' | 'delta';
}

/**
 * Sync history entry persisted to disk
 */
export interface SyncHistoryEntry {
  /**
   * Budget data from YNAB API response.
   * For full sync: complete budget.
   * For delta sync: only changed entities.
   */
  budget: BudgetDetail;

  /**
   * For delta syncs, the server_knowledge before the sync.
   * Null for full syncs.
   */
  previousServerKnowledge: number | null;

  /**
   * The server_knowledge returned by this sync.
   */
  serverKnowledge: number;

  /**
   * Type of sync performed
   */
  syncType: SyncType;

  /**
   * When this sync was performed (ISO 8601 UTC)
   */
  syncedAt: string;
}

/**
 * Performance timing data for sync operations
 */
export interface SyncPerformanceTiming {
  apiDurationMs: number;
  mergeDurationMs: number;
  persistDurationMs: number;
  rebuildMapsDurationMs: number;
  totalDurationMs: number;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Change counts from delta sync (null for full sync) */
  changesReceived: {
    accounts: number;
    categories: number;
    months: number;
    payees: number;
    scheduledTransactions: number;
    transactions: number;
  } | null;

  /** The updated local budget */
  localBudget: LocalBudget;

  /** Type of sync performed */
  syncType: SyncType;

  /** Performance timing data */
  timing: SyncPerformanceTiming;
}

/**
 * Interface for sync providers (API, Static JSON, etc.)
 */
export interface SyncProvider {
  /**
   * Perform a delta sync using last_knowledge_of_server.
   * Returns the delta response from YNAB API.
   */
  deltaSync(
    budgetId: string,
    lastKnowledge: number,
  ): Promise<{budget: BudgetDetail; serverKnowledge: number}>;

  /**
   * Perform a full sync (initial or forced).
   * Returns the complete budget from YNAB API.
   */
  fullSync(
    budgetId: string,
  ): Promise<{budget: BudgetDetail; serverKnowledge: number}>;
}

// ============================================================================
// Enriched Types (for MCP tool responses)
// ============================================================================

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
  cleared: ClearedStatus;
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
  balance_currency: number;
  cleared_balance: number;
  cleared_balance_currency: number;
  closed: boolean;
  /** If linked, whether the connection is in an error state */
  direct_import_in_error: boolean;
  /** Whether the account is linked to a financial institution for automatic import */
  direct_import_linked: boolean;
  id: string;
  name: string;
  on_budget: boolean;
  type: string;
  uncleared_balance: number;
  uncleared_balance_currency: number;
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
 * Update subtransaction input (for split transactions)
 */
export interface UpdateSubTransactionInput {
  /** Amount in milliunits (must sum to parent transaction amount) */
  amount: number;
  /** Category ID for this subtransaction */
  category_id?: string;
  /** Memo for this subtransaction (max 500 chars) */
  memo?: string;
  /** Payee ID for this subtransaction */
  payee_id?: string;
  /** Payee name (creates new if not found, max 200 chars) */
  payee_name?: string;
}

/**
 * Transaction update payload - supports full transaction editing
 */
export interface TransactionUpdate {
  /** Move transaction to different account */
  account_id?: string;
  /** Change amount (in milliunits) */
  amount?: number;
  /** Set approval status */
  approved?: boolean;
  /** Set category */
  category_id?: string;
  /** Set cleared status */
  cleared?: ClearedStatus;
  /** Change transaction date (YYYY-MM-DD) */
  date?: string;
  /** Set flag color (null to clear) */
  flag_color?: FlagColorInput | null;
  /** Transaction ID (required) */
  id: string;
  /** Set memo text */
  memo?: string;
  /** Set payee by ID */
  payee_id?: string;
  /** Set payee by name (creates new payee if not found) */
  payee_name?: string;
  /**
   * Subtransactions for split transactions.
   * WARNING: This OVERWRITES all existing subtransactions - it does not merge.
   * When provided, the parent category_id should be null.
   * Subtransaction amounts must sum to the parent amount.
   *
   * TODO: Consider adding a merge mode that fetches existing subtransactions
   * and merges with the provided ones, for a more intuitive UX.
   */
  subtransactions?: UpdateSubTransactionInput[];
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
 * Enriched scheduled subtransaction (for split scheduled transactions)
 */
export interface EnrichedScheduledSubTransaction {
  amount: number;
  amount_currency: number;
  category_id: string | null;
  category_name: string | null;
  id: string;
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
  scheduled_transaction_id: string;
  transfer_account_id: string | null;
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
  subtransactions: EnrichedScheduledSubTransaction[];
  transfer_account_id: string | null;
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
 * Create subtransaction input (for split transactions)
 */
export interface CreateSubTransactionInput {
  /** Amount in milliunits (must sum to parent transaction amount) */
  amount: number;
  /** Category ID for this subtransaction */
  category_id?: string;
  /** Memo for this subtransaction (max 500 chars) */
  memo?: string;
  /** Payee ID for this subtransaction */
  payee_id?: string;
  /** Payee name (creates new if not found, max 200 chars) */
  payee_name?: string;
}

/**
 * Create transaction input
 */
export interface CreateTransactionInput {
  account_id: string;
  amount: number;
  approved?: boolean;
  category_id?: string;
  cleared?: ClearedStatus;
  date: string;
  flag_color?: FlagColorInput;
  memo?: string;
  payee_id?: string;
  payee_name?: string;
  /**
   * Subtransactions for split transactions.
   * When provided, the parent category_id should be null.
   * Subtransaction amounts must sum to the parent amount.
   */
  subtransactions?: CreateSubTransactionInput[];
}

/**
 * Budget backup metadata
 */
export interface BudgetBackupMetadata {
  backup_timestamp: string;
  budget_id: string;
  budget_name: string;
  server_knowledge: number;
  ynab_mcp_server_version: string;
}

/**
 * Complete budget backup (raw YNAB export with metadata)
 */
export interface BudgetBackup {
  backup_metadata: BudgetBackupMetadata;
  budget: unknown; // Raw YNAB BudgetDetail response
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
