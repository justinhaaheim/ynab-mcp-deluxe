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
  EnrichedTransaction,
  PayeeHistoryResponse,
  TransactionSortBy,
  TransactionUpdate,
  UpdateTransactionsResult,
} from './types.js';

import {FastMCP} from 'fastmcp';
import {z} from 'zod';

import {
  applyJMESPath,
  calculateCategoryDistribution,
  createErrorResponse,
  filterByAccount,
  filterByDateRange,
  filterByPayee,
  sortTransactions,
  validateSelector,
} from './helpers.js';
import {ynabClient} from './ynab-client.js';

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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(message);
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(message);
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(message);
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(message);
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(message);
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

Use this to set categories, approve transactions, update memos, or set flags. Supports batch updates for efficiency.

**Parameters:**

budget - Which budget (uses default if omitted)

transactions (required) - Array of updates, each containing:
  - id (required) - Transaction ID
  - category_id - New category ID
  - approved - Set to true to approve
  - memo - New memo text
  - flag_color - "red", "orange", "yellow", "green", "blue", "purple", or null

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

Flag for review:
  {"transactions": [{"id": "abc123", "flag_color": "red"}]}

Add memo:
  {"transactions": [{"id": "abc123", "memo": "Birthday gift for Mom"}]}

**Response:**
Returns updated transactions and any failures with error messages.`,
  execute: async (args) => {
    try {
      validateSelector(args.budget as BudgetSelector | undefined, 'Budget');

      const budgetId = await ynabClient.resolveBudgetId(
        args.budget as BudgetSelector | undefined,
      );

      const updates: TransactionUpdate[] = args.transactions.map((t) => ({
        approved: t.approved,
        category_id: t.category_id,
        flag_color: t.flag_color,
        id: t.id,
        memo: t.memo,
      }));

      const result: UpdateTransactionsResult =
        await ynabClient.updateTransactions(budgetId, updates);

      return JSON.stringify(result, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(message);
    }
  },
  name: 'update_transactions',
  parameters: z.object({
    budget: BudgetSelectorSchema,
    transactions: z
      .array(
        z.object({
          approved: z.boolean().optional().describe('Set approval status'),
          category_id: z.string().optional().describe('New category ID'),
          flag_color: z
            .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])
            .nullable()
            .optional()
            .describe('Flag color (null to clear)'),
          id: z.string().describe('Transaction ID to update'),
          memo: z.string().optional().describe('New memo text'),
        }),
      )
      .min(1)
      .max(100)
      .describe('Array of transaction updates'),
  }),
});

// ============================================================================
// Start the server
// ============================================================================

void server.start({
  transportType: 'stdio',
});
