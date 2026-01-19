/**
 * YNAB API client wrapper with caching and enrichment
 */

import type {
  AccountSelector,
  BudgetSelector,
  EnrichedAccount,
  EnrichedBudgetSummary,
  EnrichedCategory,
  EnrichedPayee,
  EnrichedSubTransaction,
  EnrichedTransaction,
  TransactionUpdate,
} from './types.js';

import {
  type Account,
  api as YnabApi,
  type BudgetSummary,
  type Category,
  type CategoryGroupWithCategories,
  type CurrencyFormat,
  type Payee,
  type TransactionDetail,
  utils,
} from 'ynab';

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
   */
  async resolveBudgetId(selector?: BudgetSelector): Promise<string> {
    const budgets = await this.getBudgets();

    // If no selector provided, use last-used or error if multiple
    const hasName = selector?.name !== undefined && selector.name !== '';
    const hasId = selector?.id !== undefined && selector.id !== '';
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
        closed: a.closed,
        id: a.id,
        name: a.name,
        on_budget: a.on_budget,
        type: a.type,
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
   * Update multiple transactions
   */
  async updateTransactions(
    budgetId: string,
    updates: TransactionUpdate[],
  ): Promise<{
    failed: {error: string; id: string}[];
    updated: EnrichedTransaction[];
  }> {
    const cache = await this.getBudgetCache(budgetId);
    const api = this.getApi();

    // Build the patch request
    const patchTransactions = updates.map((u) => ({
      approved: u.approved,
      category_id: u.category_id,
      flag_color: u.flag_color,
      id: u.id,
      memo: u.memo,
    }));

    try {
      const response = await api.transactions.updateTransactions(budgetId, {
        transactions: patchTransactions,
      });

      // The API returns SaveTransactionsResponse which has transaction_ids for new ones
      // and transactions array for updated ones
      const updatedTxs = response.data.transactions ?? [];
      const enriched = updatedTxs.map((tx) =>
        this.enrichTransaction(tx, cache),
      );

      return {
        failed: [],
        updated: enriched,
      };
    } catch {
      // If bulk update fails, try individual updates to get specific errors
      const updated: EnrichedTransaction[] = [];
      const failed: {error: string; id: string}[] = [];

      for (const update of updates) {
        try {
          const response = await api.transactions.updateTransaction(
            budgetId,
            update.id,
            {
              transaction: {
                approved: update.approved,
                category_id: update.category_id,
                flag_color: update.flag_color,
                memo: update.memo,
              },
            },
          );
          updated.push(
            this.enrichTransaction(response.data.transaction, cache),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          failed.push({error: message, id: update.id});
        }
      }

      return {failed, updated};
    }
  }

  /**
   * Get currency format for a budget
   */
  async getCurrencyFormat(budgetId: string): Promise<CurrencyFormat | null> {
    const cache = await this.getBudgetCache(budgetId);
    return cache.currencyFormat;
  }

  /**
   * Clear all caches (useful for testing or refreshing data)
   */
  clearCaches(): void {
    this.budgets = null;
    this.budgetCaches.clear();
  }
}

// Export singleton instance
export const ynabClient = new YnabClient();
