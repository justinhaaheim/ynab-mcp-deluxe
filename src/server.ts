/**
 * YNAB MCP Server
 *
 * A Model Context Protocol server that provides access to the YNAB API
 * for Claude-assisted transaction categorization.
 */

import type {
  AccountSelector,
  BudgetSelector,
  CategoryGroupResponse,
  CategorySelector,
  CreateTransactionInput,
  EnrichedTransaction,
  PayeeHistoryResponse,
  PayeeSelector,
  TransactionSortBy,
  TransactionUpdate,
  UpdateTransactionsResult,
} from './types.js';

import {FastMCP} from 'fastmcp';
import {z} from 'zod';

import {
  backupAllBudgets,
  backupBudget,
  isBackupOnStartDisabled,
} from './backup.js';
import {
  applyJMESPath,
  calculateCategoryDistribution,
  createEnhancedErrorResponse,
  filterByAccount,
  filterByDateRange,
  filterByPayee,
  sortTransactions,
  validateSelector,
} from './helpers.js';
import {isReadOnlyMode, ynabClient} from './ynab-client.js';

const server = new FastMCP({
  name: 'YNAB MCP Server',
  version: '1.0.0',
});

// ============================================================================
// Zod Schemas for Tool Parameters
// ============================================================================

const BudgetSelectorSchema = z
  .object({
    id: z.string().optional().describe('Exact budget ID'),
    name: z.string().optional().describe('Budget name (case-insensitive)'),
  })
  .optional()
  .describe('Which budget to query. Required if user has multiple budgets.');

const AccountSelectorSchema = z
  .object({
    id: z.string().optional().describe('Exact account ID'),
    name: z.string().optional().describe('Account name (case-insensitive)'),
  })
  .optional()
  .describe('Filter to specific account');

// ============================================================================
// Tool 1: get_budgets
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'List YNAB Budgets',
  },
  description: `List all YNAB budgets accessible to the authenticated user.

Returns budget names, IDs, currency, and date ranges. Call this first if you need to discover available budgets.

**Parameters:** None

**Example:**
  {}`,
  execute: async () => {
    try {
      const budgets = await ynabClient.getBudgets();
      return JSON.stringify(budgets, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'List budgets');
    }
  },
  name: 'get_budgets',
  parameters: z.object({}),
});

// ============================================================================
// Tool 2: query_transactions
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Query Transactions',
  },
  description: `Query transactions from YNAB with flexible filtering.

**Default behavior (no parameters):**
- Queries the default/last-used budget
- Returns ALL transactions (not filtered by status)
- Sorted by NEWEST first
- Limited to 50 results

**Parameters (all optional):**

budget - Which budget to query
  - {"name": "My Budget"} - by name (case-insensitive)
  - {"id": "abc123..."} - by exact ID

status - Transaction status filter
  - "uncategorized" - no category assigned
  - "unapproved" - not yet approved (may have provisional category)
  - "all" (default) - all transactions

account - Filter to specific account
  - {"name": "Checking"} - by name
  - {"id": "..."} - by ID

since_date - Start date (inclusive), ISO format "YYYY-MM-DD"

until_date - End date (inclusive), ISO format "YYYY-MM-DD"

payee_contains - Fuzzy payee name match (case-insensitive)

sort_by - "newest" (default), "oldest", "amount_desc", "amount_asc"

query - JMESPath expression for advanced filtering (overrides sort_by)

limit - Max results (default 50, max 500)

**Examples:**

Recent transactions from default budget:
  {}

Uncategorized transactions:
  {"status": "uncategorized"}

From specific account:
  {"account": {"name": "Citi DoubleCash"}, "status": "uncategorized", "limit": 30}

Date range:
  {"since_date": "2024-06-01", "until_date": "2024-06-30"}

Payee search:
  {"payee_contains": "amazon"}

High-value uncategorized (over $100):
  {"status": "uncategorized", "query": "[?amount < \`-100000\` || amount > \`100000\`]"}

Just IDs and payees (minimal projection):
  {"query": "[*].{id: id, payee: payee_name, amount: amount_currency}"}

**Transaction fields available in JMESPath:**
- id, account_id, payee_id, category_id (identifiers)
- account_name, payee_name, category_name, category_group_name (resolved names)
- date, amount, amount_currency, memo, cleared, approved, flag_color
- import_id, import_payee_name, import_payee_name_original
- subtransactions (array, for split transactions)`,
  execute: async (args) => {
    try {
      // Validate selectors
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');
      validateSelector(args.account as AccountSelector | undefined, 'Account');

      // Resolve budget ID
      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      // Resolve account ID if provided
      let accountId: string | undefined;
      const hasAccountName =
        args.account?.name !== undefined && args.account.name !== '';
      const hasAccountId =
        args.account?.id !== undefined && args.account.id !== '';
      if (args.account !== undefined && (hasAccountName || hasAccountId)) {
        accountId = await ynabClient.resolveAccountId(
          budgetId,
          args.account as AccountSelector,
        );
      }

      // Determine API type parameter
      const status = args.status ?? 'all';
      const apiType: 'uncategorized' | 'unapproved' | undefined =
        status === 'all' ? undefined : status;

      // Fetch transactions
      let transactions = await ynabClient.getTransactions(budgetId, {
        accountId,
        sinceDate: args.since_date,
        type: apiType,
      });

      // Apply additional filters not supported by API
      if (args.until_date !== undefined && args.until_date !== '') {
        transactions = filterByDateRange(
          transactions,
          undefined,
          args.until_date,
        );
      }

      if (args.payee_contains !== undefined && args.payee_contains !== '') {
        transactions = filterByPayee(transactions, args.payee_contains);
      }

      // If no account in API call but account filter specified, filter here
      if (args.account !== undefined && accountId === undefined) {
        const resolvedAccountId = await ynabClient.resolveAccountId(
          budgetId,
          args.account as AccountSelector,
        );
        transactions = filterByAccount(transactions, resolvedAccountId);
      }

      // Apply JMESPath if provided
      let result: unknown = transactions;
      if (args.query !== undefined && args.query !== '') {
        result = applyJMESPath(transactions, args.query);
      } else {
        // Apply sort_by only if query is NOT provided
        const sortBy = (args.sort_by ?? 'newest') as TransactionSortBy;
        transactions = sortTransactions(transactions, sortBy);
        result = transactions;
      }

      // Apply limit
      const limit = args.limit ?? 50;
      if (Array.isArray(result)) {
        result = result.slice(0, limit);
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Query transactions');
    }
  },
  name: 'query_transactions',
  parameters: z.object({
    account: AccountSelectorSchema,
    budget: BudgetSelectorSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .optional()
      .describe('Maximum results to return'),
    payee_contains: z
      .string()
      .optional()
      .describe(
        'Filter to transactions where payee name contains this string (case-insensitive)',
      ),
    query: z
      .string()
      .optional()
      .describe(
        'JMESPath expression for advanced filtering/projection. Applied after other filters.',
      ),
    since_date: z
      .string()
      .optional()
      .describe(
        'Only transactions on or after this date (ISO format: YYYY-MM-DD)',
      ),
    sort_by: z
      .enum(['newest', 'oldest', 'amount_desc', 'amount_asc'])
      .default('newest')
      .optional()
      .describe("Sort order. Ignored if 'query' includes sorting."),
    status: z
      .enum(['uncategorized', 'unapproved', 'all'])
      .default('all')
      .optional()
      .describe('Filter by transaction status'),
    until_date: z
      .string()
      .optional()
      .describe(
        'Only transactions on or before this date (ISO format: YYYY-MM-DD)',
      ),
  }),
});

// ============================================================================
// Tool 3: get_payee_history
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Get Payee History',
  },
  description: `Get historical categorization patterns for a payee.

Returns a category distribution summary plus the actual transactions. Use this to learn how a payee has been categorized in the past before making categorization decisions.

**Parameters:**

payee (required) - Payee name to search (case-insensitive, partial match)

budget - Which budget (uses default if omitted)

limit - Max transactions to analyze (default 100)

query - Optional JMESPath to filter/project transactions

**Examples:**

How has Starbucks been categorized?
  {"payee": "starbucks"}

Amazon transactions (limited):
  {"payee": "amazon", "limit": 50}

**Response includes:**
- category_distribution: Array of {category_name, category_group_name, count, percentage}
- transactions: The actual historical transactions`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      // Get all transactions (we need categorized ones to learn patterns)
      let transactions = await ynabClient.getTransactions(budgetId, {});

      // Filter by payee
      transactions = filterByPayee(transactions, args.payee);

      // Sort by newest first
      transactions = sortTransactions(transactions, 'newest');

      // Apply limit
      const limit = args.limit ?? 100;
      transactions = transactions.slice(0, limit);

      // Calculate category distribution
      const distribution = calculateCategoryDistribution(transactions);

      // Apply JMESPath to transactions if provided
      let resultTransactions: unknown = transactions;
      if (args.query !== undefined && args.query !== '') {
        resultTransactions = applyJMESPath(transactions, args.query);
      }

      const response: PayeeHistoryResponse = {
        category_distribution: distribution,
        payee_search: args.payee,
        total_matches: transactions.length,
        transactions: resultTransactions as EnrichedTransaction[],
      };

      return JSON.stringify(response, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Get payee history');
    }
  },
  name: 'get_payee_history',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .optional()
      .describe('Maximum transactions to analyze'),
    payee: z
      .string()
      .describe('Payee name to search for (case-insensitive, partial match)'),
    query: z
      .string()
      .optional()
      .describe('Optional JMESPath to filter/project the transactions array'),
  }),
});

// ============================================================================
// Tool 4: get_categories
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Get Categories',
  },
  description: `List all categories from a YNAB budget.

Returns categories grouped by category group, with IDs and names. Use this to discover available categories before categorizing transactions.

**Parameters:**

budget - Which budget (uses default if omitted)

include_hidden - Include hidden categories (default false)

query - Optional JMESPath expression

**Examples:**

All visible categories:
  {}

Including hidden:
  {"include_hidden": true}

Just names and IDs:
  {"query": "[*].{id: id, name: name, group: category_group_name}"}

**Response structure:**
Array of category groups, each containing:
- group_id, group_name
- categories: Array of {id, name, hidden, ...}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );
      const includeHidden = args.include_hidden ?? false;

      const {groups} = await ynabClient.getCategories(budgetId, includeHidden);

      // Transform to the response format
      const response: CategoryGroupResponse[] = groups
        .filter((g) => !g.deleted && (includeHidden || !g.hidden))
        .map((g) => ({
          categories: g.categories
            .filter((c) => !c.deleted && (includeHidden || !c.hidden))
            .map((c) => ({
              hidden: c.hidden,
              id: c.id,
              name: c.name,
            })),
          group_id: g.id,
          group_name: g.name,
        }))
        .filter((g) => g.categories.length > 0);

      // Apply JMESPath if provided
      let result: unknown = response;
      if (args.query !== undefined && args.query !== '') {
        result = applyJMESPath(response, args.query);
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Get categories');
    }
  },
  name: 'get_categories',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    include_hidden: z
      .boolean()
      .default(false)
      .optional()
      .describe('Include hidden categories'),
    query: z.string().optional().describe('Optional JMESPath expression'),
  }),
});

// ============================================================================
// Tool 5: get_accounts
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Get Accounts',
  },
  description: `List all accounts from a YNAB budget.

Returns account names, IDs, types, and balances. Use this to discover available accounts.

**Parameters:**

budget - Which budget (uses default if omitted)

include_closed - Include closed accounts (default false)

query - Optional JMESPath expression

**Examples:**

All open accounts:
  {}

Including closed:
  {"include_closed": true}

Just checking accounts:
  {"query": "[?type == 'checking']"}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );
      const includeClosed = args.include_closed ?? false;

      const accounts = await ynabClient.getAccounts(budgetId, includeClosed);

      // Apply JMESPath if provided
      let result: unknown = accounts;
      if (args.query !== undefined && args.query !== '') {
        result = applyJMESPath(accounts, args.query);
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Get accounts');
    }
  },
  name: 'get_accounts',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    include_closed: z
      .boolean()
      .default(false)
      .optional()
      .describe('Include closed accounts'),
    query: z.string().optional().describe('Optional JMESPath expression'),
  }),
});

// ============================================================================
// Tool 6: update_transactions
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: false,
    title: 'Update Transactions',
  },
  description: `Update one or more transactions in YNAB.
${isReadOnlyMode() ? '\n**⚠️ SERVER IS IN READ-ONLY MODE - This operation will fail**\n' : ''}
Supports full transaction editing including category, approval, memo, flags, date, amount, payee, account, and cleared status. Batch updates are supported for efficiency.

**Parameters:**

budget - Which budget (uses default if omitted)

transactions (required) - Array of updates, each containing:
  - id (required) - Transaction ID
  - category_id - New category ID
  - approved - Set approval status (true/false)
  - memo - New memo text
  - flag_color - "red", "orange", "yellow", "green", "blue", "purple", or null
  - date - New date (YYYY-MM-DD format)
  - amount - New amount in MILLIUNITS (negative for outflow)
  - account_id - Move to different account
  - payee_id - Set payee by ID
  - payee_name - Set payee by name (creates new payee if not found)
  - cleared - "cleared", "uncleared", or "reconciled"

**Examples:**

Categorize a single transaction:
  {"transactions": [{"id": "abc123", "category_id": "cat456"}]}

Categorize and approve:
  {"transactions": [{"id": "abc123", "category_id": "cat456", "approved": true}]}

Batch categorize:
  {"transactions": [
    {"id": "tx1", "category_id": "cat-groceries"},
    {"id": "tx2", "category_id": "cat-dining"},
    {"id": "tx3", "category_id": "cat-gas", "approved": true}
  ]}

Change amount (correct a $45.99 expense to $54.99):
  {"transactions": [{"id": "abc123", "amount": -54990}]}

Change date:
  {"transactions": [{"id": "abc123", "date": "2026-01-15"}]}

Change payee:
  {"transactions": [{"id": "abc123", "payee_name": "Amazon"}]}

Move to different account:
  {"transactions": [{"id": "abc123", "account_id": "acct-456"}]}

Flag for review:
  {"transactions": [{"id": "abc123", "flag_color": "red"}]}

**Response:**
Returns updated transactions and any failures with error messages.`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const updates: TransactionUpdate[] = args.transactions.map((t) => ({
        account_id: t.account_id,
        amount: t.amount,
        approved: t.approved,
        category_id: t.category_id,
        cleared: t.cleared,
        date: t.date,
        flag_color: t.flag_color,
        id: t.id,
        memo: t.memo,
        payee_id: t.payee_id,
        payee_name: t.payee_name,
      }));

      const result: UpdateTransactionsResult =
        await ynabClient.updateTransactions(budgetId, updates);

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Update transactions');
    }
  },
  name: 'update_transactions',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    transactions: z
      .array(
        z.object({
          account_id: z
            .string()
            .optional()
            .describe('Move to different account'),
          amount: z
            .number()
            .int()
            .optional()
            .describe('New amount in milliunits'),
          approved: z.boolean().optional().describe('Set approval status'),
          category_id: z.string().optional().describe('New category ID'),
          cleared: z
            .enum(['cleared', 'uncleared', 'reconciled'])
            .optional()
            .describe('Cleared status'),
          date: z.string().optional().describe('New date (YYYY-MM-DD)'),
          flag_color: z
            .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])
            .nullable()
            .optional()
            .describe('Flag color (null to clear)'),
          id: z.string().describe('Transaction ID to update'),
          memo: z.string().optional().describe('New memo text'),
          payee_id: z.string().optional().describe('Set payee by ID'),
          payee_name: z
            .string()
            .optional()
            .describe('Set payee by name (creates if not found)'),
        }),
      )
      .min(1)
      .max(100)
      .describe('Array of transaction updates'),
  }),
});

// ============================================================================
// Tool 7: get_payees
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Get Payees',
  },
  description: `List all payees from a YNAB budget.

Returns payee names and IDs. Useful for finding payee IDs when creating transactions.

**Parameters:**

budget - Which budget (uses default if omitted)

query - Optional JMESPath expression

**Examples:**

All payees:
  {}

Search for a payee:
  {"query": "[?contains(name, 'Amazon')]"}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const payees = await ynabClient.getPayees(budgetId);

      // Apply JMESPath if provided
      let result: unknown = payees;
      if (args.query !== undefined && args.query !== '') {
        result = applyJMESPath(payees, args.query);
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Get payees');
    }
  },
  name: 'get_payees',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    query: z.string().optional().describe('Optional JMESPath expression'),
  }),
});

// ============================================================================
// Tool 8: get_scheduled_transactions
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Get Scheduled Transactions',
  },
  description: `List scheduled (recurring) transactions from a YNAB budget.

Returns recurring transactions with frequency, next date, and amounts.

**Parameters:**

budget - Which budget (uses default if omitted)

query - Optional JMESPath expression

**Examples:**

All scheduled transactions:
  {}

Monthly bills only:
  {"query": "[?frequency == 'monthly']"}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const scheduled = await ynabClient.getScheduledTransactions(budgetId);

      // Apply JMESPath if provided
      let result: unknown = scheduled;
      if (args.query !== undefined && args.query !== '') {
        result = applyJMESPath(scheduled, args.query);
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(
        error,
        'Get scheduled transactions',
      );
    }
  },
  name: 'get_scheduled_transactions',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    query: z.string().optional().describe('Optional JMESPath expression'),
  }),
});

// ============================================================================
// Tool 9: get_months
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Get Budget Months',
  },
  description: `List budget months with summary information.

Returns monthly summaries including income, budgeted, activity, and age of money.

**Parameters:**

budget - Which budget (uses default if omitted)

query - Optional JMESPath expression

**Examples:**

All months:
  {}

Recent months with positive income:
  {"query": "[?income > \`0\`] | [-5:]"}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const months = await ynabClient.getBudgetMonths(budgetId);

      // Apply JMESPath if provided
      let result: unknown = months;
      if (args.query !== undefined && args.query !== '') {
        result = applyJMESPath(months, args.query);
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Get budget months');
    }
  },
  name: 'get_months',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    query: z.string().optional().describe('Optional JMESPath expression'),
  }),
});

// ============================================================================
// Tool 10: get_budget_summary
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: true,
    title: 'Get Budget Summary',
  },
  description: `Get detailed budget summary for a specific month.

Shows income, budgeted amounts, activity, to-be-budgeted, age of money, and category details. Useful for understanding budget health and identifying overspent categories.

**Parameters:**

budget - Which budget (uses default if omitted)

month - The budget month (default: current month)
  - "current" or omit for current month
  - "YYYY-MM-01" for specific month (use first of month)

include_hidden - Include hidden categories (default false)

query - Optional JMESPath for filtering

**Examples:**

Current month summary:
  {}

Specific month:
  {"month": "2026-01-01"}

Only overspent categories:
  {"query": "categories[?balance < \`0\`]"}

Categories with goals:
  {"query": "categories[?goal_type != null]"}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      // Determine month - use current if not specified
      let month = args.month;
      if (month === undefined || month === '' || month === 'current') {
        const now = new Date();
        month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      }

      const summary = await ynabClient.getBudgetMonth(budgetId, month);

      // Filter hidden categories if needed
      const includeHidden = args.include_hidden ?? false;
      if (!includeHidden) {
        summary.categories = summary.categories.filter((c) => !c.hidden);
      }

      // Apply JMESPath if provided
      let result: unknown = summary;
      if (args.query !== undefined && args.query !== '') {
        result = applyJMESPath(summary, args.query);
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Get budget summary');
    }
  },
  name: 'get_budget_summary',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    include_hidden: z
      .boolean()
      .default(false)
      .optional()
      .describe('Include hidden categories'),
    month: z
      .string()
      .optional()
      .describe(
        'Budget month (YYYY-MM-01 format, or "current" for current month)',
      ),
    query: z.string().optional().describe('Optional JMESPath expression'),
  }),
});

// ============================================================================
// Tool 11: create_transactions
// ============================================================================

const CategorySelectorSchema = z
  .object({
    id: z.string().optional().describe('Exact category ID'),
    name: z.string().optional().describe('Category name (case-insensitive)'),
  })
  .optional()
  .describe('Category selector');

const PayeeSelectorSchema = z
  .object({
    id: z.string().optional().describe('Exact payee ID'),
    name: z
      .string()
      .optional()
      .describe('Payee name (creates new if not found)'),
  })
  .optional()
  .describe('Payee selector');

const TransactionInputSchema = z.object({
  account: z
    .object({
      id: z.string().optional().describe('Exact account ID'),
      name: z.string().optional().describe('Account name (case-insensitive)'),
    })
    .describe('Account selector (required)'),
  amount: z
    .number()
    .int()
    .describe(
      'Amount in milliunits (negative for outflow, positive for inflow)',
    ),
  approved: z.boolean().optional().describe('Whether approved'),
  category: CategorySelectorSchema,
  cleared: z.boolean().optional().describe('Whether cleared'),
  date: z.string().describe('Transaction date (YYYY-MM-DD)'),
  flag_color: z
    .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])
    .optional()
    .describe('Flag color'),
  memo: z.string().optional().describe('Memo/note'),
  payee: PayeeSelectorSchema,
});

type TransactionInputArgs = z.infer<typeof TransactionInputSchema>;

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: false,
    title: 'Create Transactions',
  },
  description: `Create one or more transactions in YNAB.
${isReadOnlyMode() ? '\n**⚠️ SERVER IS IN READ-ONLY MODE - This operation will fail**\n' : ''}
**Parameters:**

budget - Which budget (uses default if omitted)

transactions (required) - Array of transactions to create (1-100), each containing:
  - account (required) - Account selector {"name": "..."} or {"id": "..."}
  - date (required) - Transaction date (ISO format: YYYY-MM-DD)
  - amount (required) - Amount in MILLIUNITS (integer)
    - Negative for outflow (expenses): -45990 = $45.99 expense
    - Positive for inflow (income): 300000 = $300.00 income
  - payee - Payee selector {"name": "..."} or {"id": "..."}
    - If using name and payee doesn't exist, YNAB creates it
  - category - Category selector {"name": "..."} or {"id": "..."}
  - memo - Optional memo/note
  - cleared - Whether cleared (default: false)
  - approved - Whether approved (default: false)
  - flag_color - Optional flag color

**Examples:**

Single transaction (coffee purchase $5.50):
  {"transactions": [{
    "account": {"name": "Checking"},
    "date": "2026-01-19",
    "amount": -5500,
    "payee": {"name": "Starbucks"},
    "category": {"name": "Coffee"}
  }]}

Multiple transactions:
  {"transactions": [
    {"account": {"name": "Checking"}, "date": "2026-01-19", "amount": -5500, "payee": {"name": "Starbucks"}, "category": {"name": "Coffee"}},
    {"account": {"name": "Checking"}, "date": "2026-01-19", "amount": -12000, "payee": {"name": "Amazon"}, "category": {"name": "Shopping"}}
  ]}

Paycheck ($3000):
  {"transactions": [{
    "account": {"name": "Checking"},
    "date": "2026-01-15",
    "amount": 3000000,
    "payee": {"name": "Employer"},
    "category": {"name": "Ready to Assign"},
    "approved": true,
    "cleared": true
  }]}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      // Resolve selectors for each transaction
      const inputs: CreateTransactionInput[] = await Promise.all(
        args.transactions.map(async (t: TransactionInputArgs) => {
          validateSelector(t.account as AccountSelector, 'Account');

          // Resolve account (required)
          const accountId = await ynabClient.resolveAccountId(
            budgetId,
            t.account as AccountSelector,
          );

          // Resolve category if provided
          let categoryId: string | undefined;
          const hasCategoryName =
            t.category?.name !== undefined && t.category.name !== '';
          const hasCategoryId =
            t.category?.id !== undefined && t.category.id !== '';
          if (t.category !== undefined && (hasCategoryName || hasCategoryId)) {
            categoryId = await ynabClient.resolveCategoryId(
              budgetId,
              t.category as CategorySelector,
            );
          }

          // Resolve payee if provided
          let payeeId: string | undefined;
          let payeeName: string | undefined;
          const hasPayeeName =
            t.payee?.name !== undefined && t.payee.name !== '';
          const hasPayeeId = t.payee?.id !== undefined && t.payee.id !== '';
          if (t.payee !== undefined && (hasPayeeName || hasPayeeId)) {
            const resolvedPayeeId = await ynabClient.resolvePayeeId(
              budgetId,
              t.payee as PayeeSelector,
            );
            if (resolvedPayeeId !== null) {
              payeeId = resolvedPayeeId;
            } else if (hasPayeeName) {
              // Payee not found, use name to create new
              payeeName = t.payee.name;
            }
          }

          return {
            account_id: accountId,
            amount: t.amount,
            approved: t.approved,
            category_id: categoryId,
            cleared: t.cleared,
            date: t.date,
            flag_color: t.flag_color,
            memo: t.memo,
            payee_id: payeeId,
            payee_name: payeeName,
          };
        }),
      );

      const result = await ynabClient.createTransactions(budgetId, inputs);

      const response: {
        created: EnrichedTransaction[];
        duplicates?: string[];
        message: string;
      } = {
        created: result.created,
        message: `${result.created.length} transaction(s) created successfully`,
      };

      if (result.duplicates.length > 0) {
        response.duplicates = result.duplicates;
        response.message += `, ${result.duplicates.length} duplicate(s) skipped`;
      }

      return JSON.stringify(response, null, 2);
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Create transactions');
    }
  },
  name: 'create_transactions',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    transactions: z
      .array(TransactionInputSchema)
      .min(1)
      .max(100)
      .describe('Array of transactions to create'),
  }),
});

// ============================================================================
// Tool 12: delete_transaction
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: false,
    title: 'Delete Transaction',
  },
  description: `Delete a transaction from YNAB.
${isReadOnlyMode() ? '\n**⚠️ SERVER IS IN READ-ONLY MODE - This operation will fail**\n' : ''}
**Parameters:**

budget - Which budget (uses default if omitted)

transaction_id (required) - The ID of the transaction to delete

**Example:**

  {"transaction_id": "abc123-def456"}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const result = await ynabClient.deleteTransaction(
        budgetId,
        args.transaction_id,
      );

      return JSON.stringify(
        {
          deleted_transaction: result.deleted,
          message: 'Transaction deleted successfully',
        },
        null,
        2,
      );
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Delete transaction');
    }
  },
  name: 'delete_transaction',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    transaction_id: z.string().describe('Transaction ID to delete'),
  }),
});

// ============================================================================
// Tool 13: import_transactions
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: false,
    title: 'Import Transactions',
  },
  description: `Trigger import of transactions from linked financial institutions.
${isReadOnlyMode() ? '\n**⚠️ SERVER IS IN READ-ONLY MODE - This operation will fail**\n' : ''}
This initiates a sync with linked bank accounts to import new transactions.

**Parameters:**

budget - Which budget (uses default if omitted)

**Example:**

  {}`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const result = await ynabClient.importTransactions(budgetId);

      return JSON.stringify(
        {
          imported_count: result.imported_count,
          message:
            result.imported_count > 0
              ? `Imported ${result.imported_count} transaction(s)`
              : 'No new transactions to import',
          transaction_ids: result.transaction_ids,
        },
        null,
        2,
      );
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Import transactions');
    }
  },
  name: 'import_transactions',
  parameters: z.object({
    budget: BudgetSelectorSchema,
  }),
});

// ============================================================================
// Tool 14: update_category_budget
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: true,
    readOnlyHint: false,
    title: 'Update Category Budget',
  },
  description: `Update the budgeted amount for a category in a specific month.
${isReadOnlyMode() ? '\n**⚠️ SERVER IS IN READ-ONLY MODE - This operation will fail**\n' : ''}
Use this to allocate funds to categories or move money between categories.

**Parameters:**

budget - Which budget (uses default if omitted)

month (required) - Budget month in ISO format (first of month, e.g., "2026-01-01")

category (required) - Category selector {"name": "..."} or {"id": "..."}

budgeted (required) - The total amount to budget in MILLIUNITS
  - This SETS the total, not an increment
  - Example: 500000 to budget $500.00 total

**Examples:**

Set Groceries budget to $600:
  {
    "month": "2026-01-01",
    "category": {"name": "Groceries"},
    "budgeted": 600000
  }

Fund emergency fund with $1000:
  {
    "month": "2026-01-01",
    "category": {"name": "Emergency Fund"},
    "budgeted": 1000000
  }`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');
      validateSelector(args.category as CategorySelector, 'Category');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      // Resolve category
      const categoryId = await ynabClient.resolveCategoryId(
        budgetId,
        args.category as CategorySelector,
      );

      const result = await ynabClient.updateCategoryBudget(
        budgetId,
        args.month,
        categoryId,
        args.budgeted,
      );

      return JSON.stringify(
        {
          category: result,
          message: `Successfully updated ${result.name} budget to ${result.budgeted_currency}`,
        },
        null,
        2,
      );
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Update category budget');
    }
  },
  name: 'update_category_budget',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    budgeted: z
      .number()
      .int()
      .describe('Amount to budget in milliunits (e.g., 500000 = $500)'),
    category: z
      .object({
        id: z.string().optional().describe('Exact category ID'),
        name: z
          .string()
          .optional()
          .describe('Category name (case-insensitive)'),
      })
      .describe('Category selector (required)'),
    month: z.string().describe('Budget month (YYYY-MM-01 format)'),
  }),
});

// ============================================================================
// Tool 15: backup_budget
// ============================================================================

server.addTool({
  annotations: {
    openWorldHint: false,
    readOnlyHint: true, // Doesn't modify YNAB data (only writes local files)
    title: 'Backup Budget',
  },
  description: `Create a local backup of a YNAB budget.

Saves a complete export of the budget to disk, including all accounts, categories, transactions, scheduled transactions, and budget month allocations.

**Parameters:**

budget - Which budget to backup (uses default if omitted)

**Returns:**
- file_path: Full path to the backup file
- budget_name: Name of the backed up budget
- backup_timestamp: When the backup was created

**Backup location:** ~/.config/ynab-mcp-deluxe/backups/
**Filename format:** YYYY-MM-DD_HH-mm-ss_ynab-budget-[id]_backup.json

**Example:**

Backup default budget:
  {}

Backup specific budget:
  {"budget": {"name": "Household Budget"}}`,
  execute: async (args, {log}) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const budgetInfo = await ynabClient.getBudgetInfo(budgetId);

      log.info('Starting backup...', {
        budget_id: budgetId,
        budget_name: budgetInfo.name,
      });

      const filePath = await backupBudget(budgetId);

      log.info('Backup complete', {file_path: filePath});

      return JSON.stringify(
        {
          backup_timestamp: new Date().toISOString(),
          budget_id: budgetId,
          budget_name: budgetInfo.name,
          file_path: filePath,
          message: `Successfully backed up "${budgetInfo.name}" to ${filePath}`,
        },
        null,
        2,
      );
    } catch (error) {
      return await createEnhancedErrorResponse(error, 'Backup budget');
    }
  },
  name: 'backup_budget',
  parameters: z.object({
    budget: BudgetSelectorSchema,
  }),
});

// ============================================================================
// Startup backup and server start
// ============================================================================

async function performStartupBackup(): Promise<void> {
  if (isBackupOnStartDisabled()) {
    console.error(
      '[YNAB MCP] Startup backup disabled via YNAB_BACKUP_ON_START=false',
    );
    return;
  }

  try {
    console.error('[YNAB MCP] Performing startup backup...');
    const paths = await backupAllBudgets();
    for (const path of paths) {
      console.error(`[YNAB MCP] Backed up: ${path}`);
    }
    console.error(
      `[YNAB MCP] Startup backup complete (${paths.length} budget(s))`,
    );
  } catch (error) {
    // Log but don't fail - backup is a safety feature, not critical
    console.error(
      '[YNAB MCP] Startup backup failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

void performStartupBackup().then(() => {
  void server.start({transportType: 'stdio'});
});
