/**
 * YNAB API client wrapper with caching and enrichment
 */

import type {
  AccountSelector,
  BudgetSelector,
  CategorySelector,
  CreateTransactionInput,
  EnrichedAccount,
  EnrichedBudgetMonthDetail,
  EnrichedBudgetSummary,
  EnrichedCategory,
  EnrichedMonthCategory,
  EnrichedMonthSummary,
  EnrichedPayee,
  EnrichedScheduledTransaction,
  EnrichedSubTransaction,
  EnrichedTransaction,
  PayeeSelector,
  TransactionUpdate,
} from './types.js';

import {
  type Account,
  type AccountType,
  api as YnabApi,
  type BudgetSummary,
  type Category,
  type CategoryGroupWithCategories,
  type CurrencyFormat,
  type Payee,
  TransactionClearedStatus,
  type TransactionDetail,
  type TransactionFlagColor,
  utils,
} from 'ynab';

// ============================================================================
// Read-Only Mode Support
// ============================================================================

/**
 * Check if the server is running in read-only mode
 */
export function isReadOnlyMode(): boolean {
  const value = process.env['YNAB_READ_ONLY'];
  return value === 'true' || value === '1';
}

/**
 * Assert that write operations are allowed
 * @throws Error if read-only mode is enabled
 */
export function assertWriteAllowed(operation: string): void {
  if (isReadOnlyMode()) {
    throw new Error(
      `Write operation "${operation}" blocked: Server is in read-only mode. ` +
        `Set YNAB_READ_ONLY=false to enable writes.`,
    );
  }
}

/**
 * Cached data for a budget
 */
interface BudgetCache {
  accountById: Map<string, Account>;
  accountByName: Map<string, Account>;
  accounts: Account[];
  categories: Category[];
  categoryById: Map<string, Category>;
  categoryGroupNameById: Map<string, string>;
  categoryGroups: CategoryGroupWithCategories[];
  currencyFormat: CurrencyFormat | null;
  payeeById: Map<string, Payee>;
  payees: Payee[];
}

/**
 * YNAB client with caching
 */
class YnabClient {
  private api: YnabApi | null = null;
  private budgets: BudgetSummary[] | null = null;
  private budgetCaches = new Map<string, BudgetCache>();
  private lastUsedBudgetId: string | null = null;

  /**
   * Get the YNAB API instance, creating it if necessary
   */
  private getApi(): YnabApi {
    if (this.api === null) {
      const token = process.env['YNAB_ACCESS_TOKEN'];
      if (token === undefined || token === '') {
        throw new Error(
          'YNAB authentication failed. Check that YNAB_ACCESS_TOKEN environment variable is set.',
        );
      }
      this.api = new YnabApi(token);
    }
    return this.api;
  }

  /**
   * Get all budgets
   */
  async getBudgets(): Promise<EnrichedBudgetSummary[]> {
    if (this.budgets === null) {
      const response = await this.getApi().budgets.getBudgets();
      this.budgets = response.data.budgets;
    }

    return this.budgets.map((b) => ({
      currency_format:
        b.currency_format !== undefined && b.currency_format !== null
          ? {
              currency_symbol: b.currency_format.currency_symbol,
              decimal_digits: b.currency_format.decimal_digits,
              decimal_separator: b.currency_format.decimal_separator,
              example_format: b.currency_format.example_format,
              iso_code: b.currency_format.iso_code,
              symbol_first: b.currency_format.symbol_first,
            }
          : null,
      first_month: b.first_month ?? null,
      id: b.id,
      last_modified_on: b.last_modified_on ?? null,
      last_month: b.last_month ?? null,
      name: b.name,
    }));
  }

  /**
   * Resolve a budget selector to a budget ID
   *
   * IMPORTANT: If YNAB_BUDGET_ID is set, it acts as a HARD CONSTRAINT.
   * Only that budget can be accessed - any attempt to use a different
   * budget will throw an error. This is a safety mechanism for testing.
   */
  async resolveBudgetId(selector?: BudgetSelector): Promise<string> {
    const budgets = await this.getBudgets();
    const hasName = selector?.name !== undefined && selector.name !== '';
    const hasId = selector?.id !== undefined && selector.id !== '';

    // Check for YNAB_BUDGET_ID environment variable - this is a HARD CONSTRAINT
    const envBudgetId = process.env['YNAB_BUDGET_ID'];
    const hasEnvConstraint = envBudgetId !== undefined && envBudgetId !== '';

    if (hasEnvConstraint) {
      // Verify the constrained budget exists
      const constrainedBudget = budgets.find((b) => b.id === envBudgetId);
      if (constrainedBudget === undefined) {
        throw new Error(
          `YNAB_BUDGET_ID is set to '${envBudgetId}' but no budget with that ID exists. ` +
            `Available budgets: ${budgets.map((b) => `${b.name} (${b.id})`).join(', ')}.`,
        );
      }

      // If no selector provided, use the constrained budget
      if (selector === undefined || (!hasName && !hasId)) {
        this.lastUsedBudgetId = constrainedBudget.id;
        return constrainedBudget.id;
      }

      // Validate selector format
      if (hasName && hasId) {
        throw new Error(
          "Budget selector must specify exactly one of: 'name' or 'id'.",
        );
      }

      // If selector specifies an ID, it MUST match the constrained ID
      if (hasId) {
        if (selector.id !== envBudgetId) {
          throw new Error(
            `Budget access denied. YNAB_BUDGET_ID restricts access to budget '${constrainedBudget.name}' (${envBudgetId}). ` +
              `Attempted to access budget with ID: '${selector.id}'.`,
          );
        }
        this.lastUsedBudgetId = constrainedBudget.id;
        return constrainedBudget.id;
      }

      // If selector specifies a name, resolve it and verify it matches
      const nameLower = (selector.name ?? '').toLowerCase();
      const namedBudget = budgets.find(
        (b) => b.name.toLowerCase() === nameLower,
      );
      if (namedBudget === undefined) {
        throw new Error(
          `No budget found with name: '${selector.name}'. ` +
            `Note: YNAB_BUDGET_ID restricts access to '${constrainedBudget.name}'.`,
        );
      }
      if (namedBudget.id !== envBudgetId) {
        throw new Error(
          `Budget access denied. YNAB_BUDGET_ID restricts access to budget '${constrainedBudget.name}' (${envBudgetId}). ` +
            `Attempted to access budget '${namedBudget.name}' (${namedBudget.id}).`,
        );
      }
      this.lastUsedBudgetId = constrainedBudget.id;
      return constrainedBudget.id;
    }

    // No env constraint - use normal resolution logic

    // If no selector provided, use last-used or single budget
    if (selector === undefined || (!hasName && !hasId)) {
      if (this.lastUsedBudgetId !== null) {
        return this.lastUsedBudgetId;
      }
      const firstBudget = budgets[0];
      if (budgets.length === 1 && firstBudget !== undefined) {
        this.lastUsedBudgetId = firstBudget.id;
        return firstBudget.id;
      }
      const budgetNames = budgets.map((b) => b.name).join(', ');
      throw new Error(
        `Multiple budgets found. Please specify which budget using {"name": "..."} or {"id": "..."}. Available: ${budgetNames}.`,
      );
    }

    // Validate selector has exactly one of name or id
    if (hasName && hasId) {
      throw new Error(
        "Budget selector must specify exactly one of: 'name' or 'id'.",
      );
    }

    // Find by ID
    if (hasId) {
      const budget = budgets.find((b) => b.id === selector.id);
      if (budget === undefined) {
        const budgetNames = budgets.map((b) => b.name).join(', ');
        throw new Error(
          `No budget found with ID: '${selector.id}'. Available budgets: ${budgetNames}.`,
        );
      }
      this.lastUsedBudgetId = budget.id;
      return budget.id;
    }

    // Find by name (case-insensitive)
    // At this point we know hasName is true since hasId was false
    const nameLower = (selector.name ?? '').toLowerCase();
    const budget = budgets.find((b) => b.name.toLowerCase() === nameLower);
    if (budget === undefined) {
      const budgetNames = budgets.map((b) => b.name).join(', ');
      throw new Error(
        `No budget found with name: '${selector.name}'. Available budgets: ${budgetNames}.`,
      );
    }
    this.lastUsedBudgetId = budget.id;
    return budget.id;
  }

  /**
   * Get or create the cache for a budget
   */
  private async getBudgetCache(budgetId: string): Promise<BudgetCache> {
    const existingCache = this.budgetCaches.get(budgetId);
    if (existingCache !== undefined) {
      return existingCache;
    }

    // Fetch all necessary data in parallel
    const api = this.getApi();
    const [
      accountsResponse,
      categoriesResponse,
      payeesResponse,
      budgetResponse,
    ] = await Promise.all([
      api.accounts.getAccounts(budgetId),
      api.categories.getCategories(budgetId),
      api.payees.getPayees(budgetId),
      api.budgets.getBudgetById(budgetId),
    ]);

    const accounts = accountsResponse.data.accounts;
    const categoryGroups = categoriesResponse.data.category_groups;
    const payees = payeesResponse.data.payees;
    const currencyFormat = budgetResponse.data.budget.currency_format ?? null;

    // Build lookup maps
    const accountById = new Map<string, Account>();
    const accountByName = new Map<string, Account>();
    for (const account of accounts) {
      accountById.set(account.id, account);
      accountByName.set(account.name.toLowerCase(), account);
    }

    const categoryById = new Map<string, Category>();
    const categoryGroupNameById = new Map<string, string>();
    const categories: Category[] = [];

    for (const group of categoryGroups) {
      categoryGroupNameById.set(group.id, group.name);
      for (const category of group.categories) {
        categoryById.set(category.id, category);
        categories.push(category);
      }
    }

    const payeeById = new Map<string, Payee>();
    for (const payee of payees) {
      payeeById.set(payee.id, payee);
    }

    const cache: BudgetCache = {
      accountById,
      accountByName,
      accounts,
      categories,
      categoryById,
      categoryGroupNameById,
      categoryGroups,
      currencyFormat,
      payeeById,
      payees,
    };

    this.budgetCaches.set(budgetId, cache);
    return cache;
  }

  /**
   * Convert milliunits to currency amount
   */
  private toCurrency(
    milliunits: number,
    currencyFormat: CurrencyFormat | null,
  ): number {
    const decimalDigits = currencyFormat?.decimal_digits ?? 2;
    return utils.convertMilliUnitsToCurrencyAmount(milliunits, decimalDigits);
  }

  /**
   * Enrich a transaction with resolved names
   */
  private enrichTransaction(
    tx: TransactionDetail,
    cache: BudgetCache,
  ): EnrichedTransaction {
    // Get category group name
    let categoryGroupName: string | null = null;
    if (tx.category_id !== undefined && tx.category_id !== null) {
      const category = cache.categoryById.get(tx.category_id);
      if (category !== undefined) {
        categoryGroupName =
          cache.categoryGroupNameById.get(category.category_group_id) ?? null;
      }
    }

    // Enrich subtransactions
    const enrichedSubtransactions: EnrichedSubTransaction[] =
      tx.subtransactions.map((sub) => {
        let subCategoryGroupName: string | null = null;
        if (sub.category_id !== undefined && sub.category_id !== null) {
          const category = cache.categoryById.get(sub.category_id);
          if (category !== undefined) {
            subCategoryGroupName =
              cache.categoryGroupNameById.get(category.category_group_id) ??
              null;
          }
        }

        return {
          amount: sub.amount,
          amount_currency: this.toCurrency(sub.amount, cache.currencyFormat),
          category_group_name: subCategoryGroupName,
          category_id: sub.category_id ?? null,
          category_name: sub.category_name ?? null,
          id: sub.id,
          memo: sub.memo ?? null,
          payee_id: sub.payee_id ?? null,
          payee_name: sub.payee_name ?? null,
          transaction_id: sub.transaction_id,
          transfer_account_id: sub.transfer_account_id ?? null,
        };
      });

    return {
      account_id: tx.account_id,
      account_name: tx.account_name,
      amount: tx.amount,
      amount_currency: this.toCurrency(tx.amount, cache.currencyFormat),
      approved: tx.approved,
      category_group_name: categoryGroupName,
      category_id: tx.category_id ?? null,
      category_name: tx.category_name ?? null,
      cleared: tx.cleared as 'cleared' | 'uncleared' | 'reconciled',
      date: tx.date,
      flag_color: tx.flag_color ?? null,
      id: tx.id,
      import_id: tx.import_id ?? null,
      import_payee_name: tx.import_payee_name ?? null,
      import_payee_name_original: tx.import_payee_name_original ?? null,
      memo: tx.memo ?? null,
      payee_id: tx.payee_id ?? null,
      payee_name: tx.payee_name ?? null,
      subtransactions: enrichedSubtransactions,
      transfer_account_id: tx.transfer_account_id ?? null,
    };
  }

  /**
   * Get transactions with optional filters
   */
  async getTransactions(
    budgetId: string,
    options: {
      accountId?: string;
      sinceDate?: string;
      type?: 'uncategorized' | 'unapproved';
    } = {},
  ): Promise<EnrichedTransaction[]> {
    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    let transactions: TransactionDetail[];

    if (options.accountId !== undefined && options.accountId !== '') {
      // Use account-specific endpoint
      const response = await api.transactions.getTransactionsByAccount(
        budgetId,
        options.accountId,
        options.sinceDate,
        options.type,
      );
      transactions = response.data.transactions;
    } else {
      // Use main transactions endpoint
      const response = await api.transactions.getTransactions(
        budgetId,
        options.sinceDate,
        options.type,
      );
      transactions = response.data.transactions;
    }

    // Filter out deleted transactions
    return transactions
      .filter((tx) => !tx.deleted)
      .map((tx) => this.enrichTransaction(tx, cache));
  }

  /**
   * Resolve an account selector to an account ID
   */
  async resolveAccountId(
    budgetId: string,
    selector: AccountSelector,
  ): Promise<string> {
    const cache = await this.getBudgetCache(budgetId);

    // Validate selector has exactly one of name or id
    const selectorHasName = selector.name !== undefined && selector.name !== '';
    const selectorHasId = selector.id !== undefined && selector.id !== '';

    if (selectorHasName && selectorHasId) {
      throw new Error(
        "Account selector must specify exactly one of: 'name' or 'id'.",
      );
    }
    if (!selectorHasName && !selectorHasId) {
      throw new Error("Account selector must specify 'name' or 'id'.");
    }

    // Find by ID
    if (selectorHasId) {
      const account = cache.accountById.get(selector.id ?? '');
      if (account === undefined) {
        const accountNames = cache.accounts
          .filter((a) => !a.closed && !a.deleted)
          .map((a) => a.name)
          .join(', ');
        throw new Error(
          `No account found with ID: '${selector.id}'. Available accounts: ${accountNames}.`,
        );
      }
      return account.id;
    }

    // Find by name (case-insensitive)
    const nameLower = (selector.name ?? '').toLowerCase();
    const account = cache.accountByName.get(nameLower);
    if (account === undefined) {
      const accountNames = cache.accounts
        .filter((a) => !a.closed && !a.deleted)
        .map((a) => a.name)
        .join(', ');
      throw new Error(
        `No account found with name: '${selector.name}'. Available accounts: ${accountNames}.`,
      );
    }
    return account.id;
  }

  /**
   * Get all accounts for a budget
   */
  async getAccounts(
    budgetId: string,
    includeClosed = false,
  ): Promise<EnrichedAccount[]> {
    const cache = await this.getBudgetCache(budgetId);

    return cache.accounts
      .filter((a) => !a.deleted && (includeClosed || !a.closed))
      .map((a) => ({
        balance: a.balance,
        balance_currency: this.toCurrency(a.balance, cache.currencyFormat),
        cleared_balance: a.cleared_balance,
        cleared_balance_currency: this.toCurrency(
          a.cleared_balance,
          cache.currencyFormat,
        ),
        closed: a.closed,
        direct_import_in_error: a.direct_import_in_error ?? false,
        direct_import_linked: a.direct_import_linked ?? false,
        id: a.id,
        name: a.name,
        on_budget: a.on_budget,
        type: a.type,
        uncleared_balance: a.uncleared_balance,
        uncleared_balance_currency: this.toCurrency(
          a.uncleared_balance,
          cache.currencyFormat,
        ),
      }));
  }

  /**
   * Get all categories for a budget
   */
  async getCategories(
    budgetId: string,
    includeHidden = false,
  ): Promise<{
    flat: EnrichedCategory[];
    groups: CategoryGroupWithCategories[];
  }> {
    const cache = await this.getBudgetCache(budgetId);

    const flat: EnrichedCategory[] = cache.categories
      .filter((c) => !c.deleted && (includeHidden || !c.hidden))
      .map((c) => ({
        activity: c.activity,
        balance: c.balance,
        budgeted: c.budgeted,
        category_group_id: c.category_group_id,
        category_group_name:
          cache.categoryGroupNameById.get(c.category_group_id) ?? '',
        deleted: c.deleted,
        hidden: c.hidden,
        id: c.id,
        name: c.name,
      }));

    return {flat, groups: cache.categoryGroups};
  }

  /**
   * Get all payees for a budget
   */
  async getPayees(budgetId: string): Promise<EnrichedPayee[]> {
    const cache = await this.getBudgetCache(budgetId);

    return cache.payees
      .filter((p) => !p.deleted)
      .map((p) => ({
        id: p.id,
        name: p.name,
        transfer_account_id: p.transfer_account_id ?? null,
      }));
  }

  /**
   * Update multiple transactions using the bulk PATCH endpoint
   */
  async updateTransactions(
    budgetId: string,
    updates: TransactionUpdate[],
  ): Promise<{
    updated: EnrichedTransaction[];
  }> {
    assertWriteAllowed('update_transactions');

    const api = this.getApi();

    // Map cleared string to YNAB enum
    const mapCleared = (
      cleared?: string,
    ): TransactionClearedStatus | undefined => {
      if (cleared === undefined) return undefined;
      switch (cleared) {
        case 'cleared':
          return TransactionClearedStatus.Cleared;
        case 'reconciled':
          return TransactionClearedStatus.Reconciled;
        case 'uncleared':
          return TransactionClearedStatus.Uncleared;
        default:
          return undefined;
      }
    };

    // Build the patch request with all supported fields
    // TODO: Consider adding a merge mode that fetches existing subtransactions
    // and merges with the provided ones, for a more intuitive UX. Currently,
    // providing subtransactions will OVERWRITE all existing ones (matching YNAB API behavior).
    const patchTransactions = updates.map((u) => ({
      account_id: u.account_id,
      amount: u.amount,
      approved: u.approved,
      category_id: u.category_id,
      cleared: mapCleared(u.cleared),
      date: u.date,
      flag_color: u.flag_color as TransactionFlagColor | null | undefined,
      id: u.id,
      memo: u.memo,
      payee_id: u.payee_id,
      payee_name: u.payee_name,
      subtransactions: u.subtransactions?.map((sub) => ({
        amount: sub.amount,
        category_id: sub.category_id,
        memo: sub.memo,
        payee_id: sub.payee_id,
        payee_name: sub.payee_name,
      })),
    }));

    const response = await api.transactions.updateTransactions(budgetId, {
      transactions: patchTransactions,
    });

    // The API returns SaveTransactionsResponse which has transaction_ids for new ones
    // and transactions array for updated ones
    const updatedTxs = response.data.transactions ?? [];

    // Always invalidate cache after write operations to ensure consistency
    // (payees may be created, and we want fresh data for enrichment)
    this.budgetCaches.delete(budgetId);
    const freshCache = await this.getBudgetCache(budgetId);
    const enriched = updatedTxs.map((tx) =>
      this.enrichTransaction(tx, freshCache),
    );

    return {
      updated: enriched,
    };
  }

  /**
   * Get currency format for a budget
   */
  async getCurrencyFormat(budgetId: string): Promise<CurrencyFormat | null> {
    const cache = await this.getBudgetCache(budgetId);
    return cache.currencyFormat;
  }

  /**
   * Get budget info (name, id) for journaling
   */
  async getBudgetInfo(budgetId: string): Promise<{id: string; name: string}> {
    const budgets = await this.getBudgets();
    const budget = budgets.find((b) => b.id === budgetId);
    if (budget === undefined) {
      return {id: budgetId, name: 'Unknown Budget'};
    }
    return {id: budget.id, name: budget.name};
  }

  /**
   * Get raw budget detail for backup purposes
   * Returns the complete budget data as returned by YNAB API
   * (effectively a full budget export per YNAB docs)
   */
  async getBudgetByIdRaw(budgetId: string): Promise<{
    budget: unknown;
    server_knowledge: number;
  }> {
    const api = this.getApi();
    const response = await api.budgets.getBudgetById(budgetId);
    return {
      budget: response.data.budget,
      server_knowledge: response.data.server_knowledge,
    };
  }

  /**
   * Resolve a category selector to a category ID
   */
  async resolveCategoryId(
    budgetId: string,
    selector: CategorySelector,
  ): Promise<string> {
    const cache = await this.getBudgetCache(budgetId);

    const selectorHasName = selector.name !== undefined && selector.name !== '';
    const selectorHasId = selector.id !== undefined && selector.id !== '';

    if (selectorHasName && selectorHasId) {
      throw new Error(
        "Category selector must specify exactly one of: 'name' or 'id'.",
      );
    }
    if (!selectorHasName && !selectorHasId) {
      throw new Error("Category selector must specify 'name' or 'id'.");
    }

    // Find by ID
    if (selectorHasId) {
      const category = cache.categoryById.get(selector.id ?? '');
      if (category === undefined) {
        const categoryNames = cache.categories
          .filter((c) => !c.deleted && !c.hidden)
          .slice(0, 20)
          .map((c) => c.name)
          .join(', ');
        throw new Error(
          `No category found with ID: '${selector.id}'. Some available categories: ${categoryNames}...`,
        );
      }
      return category.id;
    }

    // Find by name (case-insensitive)
    const nameLower = (selector.name ?? '').toLowerCase();
    const category = cache.categories.find(
      (c) => !c.deleted && c.name.toLowerCase() === nameLower,
    );
    if (category === undefined) {
      const categoryNames = cache.categories
        .filter((c) => !c.deleted && !c.hidden)
        .slice(0, 20)
        .map((c) => c.name)
        .join(', ');
      throw new Error(
        `No category found with name: '${selector.name}'. Some available categories: ${categoryNames}...`,
      );
    }
    return category.id;
  }

  /**
   * Resolve a payee selector to a payee ID
   */
  async resolvePayeeId(
    budgetId: string,
    selector: PayeeSelector,
  ): Promise<string | null> {
    const cache = await this.getBudgetCache(budgetId);

    const selectorHasName = selector.name !== undefined && selector.name !== '';
    const selectorHasId = selector.id !== undefined && selector.id !== '';

    if (selectorHasName && selectorHasId) {
      throw new Error(
        "Payee selector must specify exactly one of: 'name' or 'id'.",
      );
    }
    if (!selectorHasName && !selectorHasId) {
      return null; // No payee specified
    }

    // Find by ID
    if (selectorHasId) {
      const payee = cache.payeeById.get(selector.id ?? '');
      if (payee === undefined) {
        throw new Error(`No payee found with ID: '${selector.id}'.`);
      }
      return payee.id;
    }

    // Find by name (case-insensitive) - return null if not found (will create new)
    const nameLower = (selector.name ?? '').toLowerCase();
    const payee = cache.payees.find(
      (p) => !p.deleted && p.name.toLowerCase() === nameLower,
    );
    // Return null if not found - YNAB will create the payee
    return payee?.id ?? null;
  }

  /**
   * Get a single transaction by ID
   */
  async getTransaction(
    budgetId: string,
    transactionId: string,
  ): Promise<EnrichedTransaction> {
    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    const response = await api.transactions.getTransactionById(
      budgetId,
      transactionId,
    );

    return this.enrichTransaction(response.data.transaction, cache);
  }

  /**
   * Get scheduled transactions
   */
  async getScheduledTransactions(
    budgetId: string,
  ): Promise<EnrichedScheduledTransaction[]> {
    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    const response =
      await api.scheduledTransactions.getScheduledTransactions(budgetId);

    return response.data.scheduled_transactions
      .filter((txn) => !txn.deleted)
      .map((txn) => ({
        account_id: txn.account_id,
        account_name: txn.account_name,
        amount: txn.amount,
        amount_currency: this.toCurrency(txn.amount, cache.currencyFormat),
        category_id: txn.category_id ?? null,
        category_name: txn.category_name ?? null,
        date_first: txn.date_first,
        date_next: txn.date_next,
        flag_color: txn.flag_color ?? null,
        frequency: txn.frequency,
        id: txn.id,
        memo: txn.memo ?? null,
        payee_id: txn.payee_id ?? null,
        payee_name: txn.payee_name ?? null,
        subtransactions: txn.subtransactions
          .filter((sub) => !sub.deleted)
          .map((sub) => ({
            amount: sub.amount,
            amount_currency: this.toCurrency(sub.amount, cache.currencyFormat),
            category_id: sub.category_id ?? null,
            category_name: sub.category_name ?? null,
            id: sub.id,
            memo: sub.memo ?? null,
            payee_id: sub.payee_id ?? null,
            payee_name: sub.payee_name ?? null,
            scheduled_transaction_id: sub.scheduled_transaction_id,
            transfer_account_id: sub.transfer_account_id ?? null,
          })),
        transfer_account_id: txn.transfer_account_id ?? null,
      }));
  }

  /**
   * Get budget months list
   */
  async getBudgetMonths(budgetId: string): Promise<EnrichedMonthSummary[]> {
    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    const response = await api.months.getBudgetMonths(budgetId);

    return response.data.months.map((month) => ({
      activity: month.activity,
      activity_currency: this.toCurrency(month.activity, cache.currencyFormat),
      age_of_money: month.age_of_money ?? null,
      budgeted: month.budgeted,
      budgeted_currency: this.toCurrency(month.budgeted, cache.currencyFormat),
      income: month.income,
      income_currency: this.toCurrency(month.income, cache.currencyFormat),
      month: month.month,
      note: month.note ?? null,
      to_be_budgeted: month.to_be_budgeted,
      to_be_budgeted_currency: this.toCurrency(
        month.to_be_budgeted,
        cache.currencyFormat,
      ),
    }));
  }

  /**
   * Get budget month detail with categories
   */
  async getBudgetMonth(
    budgetId: string,
    month: string,
  ): Promise<EnrichedBudgetMonthDetail> {
    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    const response = await api.months.getBudgetMonth(budgetId, month);
    const monthData = response.data.month;

    const categories: EnrichedMonthCategory[] = monthData.categories
      .filter((c) => !c.deleted)
      .map((c) => ({
        activity: c.activity,
        activity_currency: this.toCurrency(c.activity, cache.currencyFormat),
        balance: c.balance,
        balance_currency: this.toCurrency(c.balance, cache.currencyFormat),
        budgeted: c.budgeted,
        budgeted_currency: this.toCurrency(c.budgeted, cache.currencyFormat),
        category_group_id: c.category_group_id,
        category_group_name:
          cache.categoryGroupNameById.get(c.category_group_id) ?? '',
        goal_percentage_complete: c.goal_percentage_complete ?? null,
        goal_target: c.goal_target ?? null,
        goal_type: c.goal_type ?? null,
        hidden: c.hidden,
        id: c.id,
        name: c.name,
      }));

    return {
      activity: monthData.activity,
      activity_currency: this.toCurrency(
        monthData.activity,
        cache.currencyFormat,
      ),
      age_of_money: monthData.age_of_money ?? null,
      budgeted: monthData.budgeted,
      budgeted_currency: this.toCurrency(
        monthData.budgeted,
        cache.currencyFormat,
      ),
      categories,
      income: monthData.income,
      income_currency: this.toCurrency(monthData.income, cache.currencyFormat),
      month: monthData.month,
      note: monthData.note ?? null,
      to_be_budgeted: monthData.to_be_budgeted,
      to_be_budgeted_currency: this.toCurrency(
        monthData.to_be_budgeted,
        cache.currencyFormat,
      ),
    };
  }

  /**
   * Create one or more transactions
   */
  async createTransactions(
    budgetId: string,
    transactions: CreateTransactionInput[],
  ): Promise<{
    created: EnrichedTransaction[];
    duplicates: string[];
  }> {
    assertWriteAllowed('create_transactions');

    const api = this.getApi();

    const response = await api.transactions.createTransaction(budgetId, {
      transactions: transactions.map((transaction) => ({
        account_id: transaction.account_id,
        amount: transaction.amount,
        approved: transaction.approved ?? false,
        category_id: transaction.category_id,
        cleared:
          transaction.cleared === 'reconciled'
            ? TransactionClearedStatus.Reconciled
            : transaction.cleared === 'cleared'
              ? TransactionClearedStatus.Cleared
              : TransactionClearedStatus.Uncleared,
        date: transaction.date,
        flag_color: transaction.flag_color as TransactionFlagColor | undefined,
        memo: transaction.memo,
        payee_id: transaction.payee_id,
        payee_name: transaction.payee_name,
        subtransactions: transaction.subtransactions?.map((sub) => ({
          amount: sub.amount,
          category_id: sub.category_id,
          memo: sub.memo,
          payee_id: sub.payee_id,
          payee_name: sub.payee_name,
        })),
      })),
    });

    // Invalidate cache since payees may have been created
    this.budgetCaches.delete(budgetId);

    const createdTransactions = response.data.transactions ?? [];
    const duplicateImportIds = response.data.duplicate_import_ids ?? [];

    const newCache = await this.getBudgetCache(budgetId);
    const enriched = createdTransactions.map((t) =>
      this.enrichTransaction(t, newCache),
    );

    return {
      created: enriched,
      duplicates: duplicateImportIds,
    };
  }

  /**
   * Delete a transaction
   */
  async deleteTransaction(
    budgetId: string,
    transactionId: string,
  ): Promise<{deleted: EnrichedTransaction}> {
    assertWriteAllowed('delete_transaction');

    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    const response = await api.transactions.deleteTransaction(
      budgetId,
      transactionId,
    );

    return {
      deleted: this.enrichTransaction(response.data.transaction, cache),
    };
  }

  /**
   * Import transactions from linked accounts
   */
  async importTransactions(
    budgetId: string,
  ): Promise<{imported_count: number; transaction_ids: string[]}> {
    assertWriteAllowed('import_transactions');

    const api = this.getApi();

    const response = await api.transactions.importTransactions(budgetId);

    // Invalidate cache since import may create new payees
    this.budgetCaches.delete(budgetId);

    return {
      imported_count: response.data.transaction_ids.length,
      transaction_ids: response.data.transaction_ids,
    };
  }

  /**
   * Create a new account
   */
  async createAccount(
    budgetId: string,
    name: string,
    type: AccountType,
    balance: number,
  ): Promise<EnrichedAccount> {
    assertWriteAllowed('create_account');

    const api = this.getApi();

    const response = await api.accounts.createAccount(budgetId, {
      account: {
        balance,
        name,
        type,
      },
    });

    // Invalidate cache since we've added a new account
    this.budgetCaches.delete(budgetId);

    const account = response.data.account;
    const cache = await this.getBudgetCache(budgetId);

    return {
      balance: account.balance,
      balance_currency: this.toCurrency(account.balance, cache.currencyFormat),
      cleared_balance: account.cleared_balance,
      cleared_balance_currency: this.toCurrency(
        account.cleared_balance,
        cache.currencyFormat,
      ),
      closed: account.closed,
      direct_import_in_error: account.direct_import_in_error ?? false,
      direct_import_linked: account.direct_import_linked ?? false,
      id: account.id,
      name: account.name,
      on_budget: account.on_budget,
      type: account.type,
      uncleared_balance: account.uncleared_balance,
      uncleared_balance_currency: this.toCurrency(
        account.uncleared_balance,
        cache.currencyFormat,
      ),
    };
  }

  /**
   * Update category budget for a month
   */
  async updateCategoryBudget(
    budgetId: string,
    month: string,
    categoryId: string,
    budgeted: number,
  ): Promise<EnrichedMonthCategory> {
    assertWriteAllowed('update_category_budget');

    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    const response = await api.categories.updateMonthCategory(
      budgetId,
      month,
      categoryId,
      {
        category: {
          budgeted,
        },
      },
    );

    const c = response.data.category;

    return {
      activity: c.activity,
      activity_currency: this.toCurrency(c.activity, cache.currencyFormat),
      balance: c.balance,
      balance_currency: this.toCurrency(c.balance, cache.currencyFormat),
      budgeted: c.budgeted,
      budgeted_currency: this.toCurrency(c.budgeted, cache.currencyFormat),
      category_group_id: c.category_group_id,
      category_group_name:
        cache.categoryGroupNameById.get(c.category_group_id) ?? '',
      goal_percentage_complete: c.goal_percentage_complete ?? null,
      goal_target: c.goal_target ?? null,
      goal_type: c.goal_type ?? null,
      hidden: c.hidden,
      id: c.id,
      name: c.name,
    };
  }

  /**
   * Clear all caches (useful for testing or refreshing data)
   */
  clearCaches(): void {
    this.budgets = null;
    this.budgetCaches.clear();
  }

  /**
   * Invalidate cache for a specific budget, forcing fresh data on next access.
   * If no budgetId provided, invalidates all budget caches.
   */
  invalidateCache(budgetId?: string): void {
    if (budgetId !== undefined) {
      this.budgetCaches.delete(budgetId);
    } else {
      this.budgetCaches.clear();
      this.budgets = null;
    }
  }
}

// Export singleton instance
export const ynabClient = new YnabClient();
