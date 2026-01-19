# Competitive Analysis: calebl/ynab-mcp-server vs ynab-mcp-deluxe

**Date:** 2026-01-19
**Reference Project:** https://github.com/calebl/ynab-mcp-server
**Reference Project Location:** `reference-projects/ynab-mcp-server/`

---

## TL;DR - Priority Implementation Roadmap

### High Priority (Core YNAB Workflows)

| Feature                    | Why It Matters                                                                                          | Effort |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| **Create Transaction**     | Essential for manual transaction entry workflow (e.g., "Add a $5 coffee purchase from Starbucks today") | Medium |
| **List Payees**            | Required for create_transaction (to get payee IDs) and general payee management                         | Low    |
| **Budget Summary**         | Key insight tool for understanding budget health at a glance                                            | Medium |
| **Update Category Budget** | Critical for budget management - allocate/move funds between categories                                 | Medium |

### Medium Priority (Enhanced Workflows)

| Feature                         | Why It Matters                                                  | Effort |
| ------------------------------- | --------------------------------------------------------------- | ------ |
| **List Scheduled Transactions** | View recurring bills/subscriptions; useful for planning         | Low    |
| **List Months**                 | Historical budget view; age of money, income vs spending trends | Low    |
| **Import Transactions**         | Trigger sync from linked financial institutions                 | Low    |
| **Delete Transaction**          | Complete CRUD support (rarely needed but expected)              | Low    |

### Lower Priority (Refinements)

| Feature                           | Why It Matters                                           | Effort |
| --------------------------------- | -------------------------------------------------------- | ------ |
| **YNAB_BUDGET_ID env var**        | Convenience for single-budget users                      | Low    |
| **Dedicated unapproved endpoint** | Already supported via `query_transactions` status filter | Skip   |

### Strengths to Preserve (Our Advantages)

- **JMESPath support** - Powerful querying the reference project lacks
- **get_payee_history** - Unique categorization pattern analysis
- **Enriched transactions** - category_group_name, import metadata
- **Dual amount formats** - Both milliunits and currency
- **Smart selectors** - Name-based (case-insensitive) OR ID-based lookups
- **Caching layer** - Efficient, reduces API calls

---

## Detailed Comparison

### Tool Inventory

| Tool                       | Reference Project                  | Our Project               | Notes                                                 |
| -------------------------- | ---------------------------------- | ------------------------- | ----------------------------------------------------- |
| **List Budgets**           | `ynab_list_budgets`                | `get_budgets`             | Both equivalent                                       |
| **Query Transactions**     | `ynab_get_transactions`            | `query_transactions`      | Ours has JMESPath, payee search, date ranges, sorting |
| **Get Unapproved**         | `ynab_get_unapproved_transactions` | Via `query_transactions`  | We cover this via status filter                       |
| **Create Transaction**     | `ynab_create_transaction`          | **Missing**               | High priority gap                                     |
| **Approve Transaction**    | `ynab_approve_transaction`         | Via `update_transactions` | We support this                                       |
| **Bulk Approve**           | `ynab_bulk_approve_transactions`   | Via `update_transactions` | We support this                                       |
| **Update Transaction**     | `ynab_update_transaction`          | `update_transactions`     | Theirs has more fields (date, amount, accountId)      |
| **Delete Transaction**     | `ynab_delete_transaction`          | **Missing**               | Medium priority                                       |
| **Import Transactions**    | `ynab_import_transactions`         | **Missing**               | Medium priority                                       |
| **List Categories**        | `ynab_list_categories`             | `get_categories`          | Both similar; ours has JMESPath                       |
| **List Accounts**          | `ynab_list_accounts`               | `get_accounts`            | Both similar; ours has JMESPath                       |
| **List Payees**            | `ynab_list_payees`                 | **Missing**               | High priority (needed for create)                     |
| **List Scheduled**         | `ynab_list_scheduled_transactions` | **Missing**               | Medium priority                                       |
| **List Months**            | `ynab_list_months`                 | **Missing**               | Medium priority                                       |
| **Budget Summary**         | `ynab_budget_summary`              | **Missing**               | High priority                                         |
| **Update Category Budget** | `ynab_update_category_budget`      | **Missing**               | High priority                                         |
| **Payee History**          | **Missing**                        | `get_payee_history`       | Our unique feature                                    |

### Feature Comparison

#### Reference Project Strengths

1. **More CRUD Operations**

   - Create, delete transactions
   - Import from linked accounts
   - Update category budgets

2. **More Read Operations**

   - List scheduled transactions (recurring)
   - List budget months (historical view)
   - List payees explicitly
   - Budget summary for month

3. **YNAB_BUDGET_ID Environment Variable**

   - Allows setting default budget in config
   - Reduces parameter burden for single-budget users

4. **Full Transaction Update**
   - Can update date, amount, accountId (move transaction)
   - We only update category, approval, memo, flag

#### Our Project Strengths

1. **JMESPath Query Support**

   - Powerful filtering: `[?amount < \`-100000\`]`
   - Projections: `[*].{id: id, payee: payee_name}`
   - Sorting: `sort_by(@, &date)`
   - Reference project has none of this

2. **Unique get_payee_history Tool**

   - Calculates category distribution percentages
   - Shows how payee has historically been categorized
   - Critical for AI-assisted categorization decisions

3. **Enriched Transactions**

   - `category_group_name` - Reference project doesn't include this
   - `import_payee_name` / `import_payee_name_original` - Useful for pattern matching
   - Both milliunits AND currency amount in responses

4. **Smart Selectors**

   - Budget by name OR ID (case-insensitive name matching)
   - Account by name OR ID
   - Reference project requires explicit IDs for most operations

5. **Flexible Transaction Querying**

   - `payee_contains` - Fuzzy payee matching
   - `until_date` - End date filter (reference only has sinceDate)
   - `sort_by` - Multiple sort options
   - Combined filters (status + account + date range + payee)

6. **Caching Architecture**

   - Budget-level caching of accounts, categories, payees
   - Lookup maps for O(1) enrichment
   - Reference project fetches fresh each time

7. **Better Error Handling**
   - MCP `isError` response format
   - Detailed error messages with available options
   - Graceful partial failure handling in batch updates

---

## Implementation Plan

### Phase 1: High Priority Features

#### 1.1 List Payees Tool (`get_payees`)

**Why:** Required for `create_transaction` and generally useful for payee management.

**Implementation:**

```typescript
// Already have ynabClient.getPayees() - just need the tool
server.addTool({
  name: 'get_payees',
  description: `List all payees from a YNAB budget.

Returns payee names and IDs. Useful for finding payee IDs when creating transactions.

**Parameters:**

budget - Which budget (uses default if omitted)

query - Optional JMESPath expression`,
  parameters: z.object({
    budget: BudgetSelectorSchema,
    query: z.string().optional(),
  }),
  execute: async (args) => {
    const budgetId = await ynabClient.resolveBudgetId(args.budget);
    let payees = await ynabClient.getPayees(budgetId);

    if (args.query) {
      payees = applyJMESPath(payees, args.query);
    }

    return JSON.stringify(payees, null, 2);
  },
});
```

**Effort:** Low - we already have the client method

---

#### 1.2 Create Transaction Tool (`create_transaction`)

**Why:** Essential for manual transaction entry workflows.

**Implementation:**

Add to `ynab-client.ts`:

```typescript
async createTransaction(
  budgetId: string,
  transaction: {
    accountId: string;
    date: string;
    amount: number; // In currency units (will convert to milliunits)
    payeeId?: string;
    payeeName?: string;
    categoryId?: string;
    memo?: string;
    cleared?: boolean;
    approved?: boolean;
    flagColor?: string;
  }
): Promise<EnrichedTransaction> {
  const api = this.getApi();
  const cache = await this.getBudgetCache(budgetId);

  const milliunitAmount = Math.round(transaction.amount * 1000);

  const response = await api.transactions.createTransaction(budgetId, {
    transaction: {
      account_id: transaction.accountId,
      date: transaction.date,
      amount: milliunitAmount,
      payee_id: transaction.payeeId,
      payee_name: transaction.payeeName,
      category_id: transaction.categoryId,
      memo: transaction.memo,
      cleared: transaction.cleared
        ? ynab.TransactionClearedStatus.Cleared
        : ynab.TransactionClearedStatus.Uncleared,
      approved: transaction.approved ?? false,
      flag_color: transaction.flagColor as any,
    },
  });

  return this.enrichTransaction(response.data.transaction, cache);
}
```

Add tool in `server.ts`:

```typescript
server.addTool({
  name: 'create_transaction',
  annotations: {
    readOnlyHint: false,
  },
  description: `Create a new transaction in YNAB.

**Parameters:**

budget - Which budget (uses default if omitted)

account (required) - Account selector {"name": "..."} or {"id": "..."}

date (required) - Transaction date (ISO format: YYYY-MM-DD)

amount (required) - Amount in currency units (negative for outflow, positive for inflow)
  - Example: -45.99 for a $45.99 expense

payee - Payee selector {"name": "..."} or {"id": "..."}
  - If using name, creates new payee if doesn't exist

category - Category selector {"name": "..."} or {"id": "..."}

memo - Optional memo/note

cleared - Whether cleared (default: false)

approved - Whether approved (default: false)

flag_color - Optional flag color

**Examples:**

Coffee purchase:
  {
    "account": {"name": "Checking"},
    "date": "2026-01-19",
    "amount": -5.50,
    "payee": {"name": "Starbucks"},
    "category": {"name": "Coffee"}
  }

Income:
  {
    "account": {"name": "Checking"},
    "date": "2026-01-15",
    "amount": 3000,
    "payee": {"name": "Employer"},
    "category": {"name": "Income"},
    "approved": true
  }`,
  parameters: z.object({
    budget: BudgetSelectorSchema,
    account: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
    }),
    date: z.string(),
    amount: z.number(),
    payee: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    category: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    memo: z.string().optional(),
    cleared: z.boolean().optional(),
    approved: z.boolean().optional(),
    flag_color: z
      .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])
      .optional(),
  }),
  execute: async (args) => {
    // Resolve budget, account, payee, category
    // Create transaction
    // Return enriched result
  },
});
```

**Effort:** Medium

---

#### 1.3 Budget Summary Tool (`get_budget_summary`)

**Why:** Quick overview of budget health for a month.

**Implementation:**

Add to `ynab-client.ts`:

```typescript
async getBudgetMonth(
  budgetId: string,
  month: string = 'current' // or 'YYYY-MM-DD'
): Promise<{
  month: string;
  income: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  age_of_money: number | null;
  categories: Array<{
    id: string;
    name: string;
    category_group_name: string;
    budgeted: number;
    activity: number;
    balance: number;
    goal_type: string | null;
    goal_percentage_complete: number | null;
  }>;
}> {
  const api = this.getApi();
  const response = await api.months.getBudgetMonth(budgetId, month);
  // Transform and return
}
```

Add tool:

```typescript
server.addTool({
  name: 'get_budget_summary',
  description: `Get a summary of a budget month.

Shows income, budgeted amounts, activity, and category balances.
Useful for understanding budget health and identifying overspent categories.

**Parameters:**

budget - Which budget (uses default if omitted)

month - The budget month (default: "current")
  - "current" - Current calendar month
  - "YYYY-MM-DD" - Specific month (use first of month, e.g., "2026-01-01")

query - Optional JMESPath for filtering categories

**Examples:**

Current month summary:
  {}

January 2026:
  {"month": "2026-01-01"}

Only overspent categories:
  {"query": "categories[?balance < \`0\`]"}`,
  // ... implementation
});
```

**Effort:** Medium

---

#### 1.4 Update Category Budget Tool (`update_category_budget`)

**Why:** Critical for budget management - allocating and moving funds.

**Implementation:**

Add to `ynab-client.ts`:

```typescript
async updateCategoryBudget(
  budgetId: string,
  month: string,
  categoryId: string,
  budgeted: number // In currency units
): Promise<{
  id: string;
  name: string;
  budgeted: number;
  activity: number;
  balance: number;
}> {
  const api = this.getApi();
  const milliunitAmount = Math.round(budgeted * 1000);

  const response = await api.categories.updateMonthCategory(
    budgetId,
    month,
    categoryId,
    { category: { budgeted: milliunitAmount } }
  );

  // Transform and return
}
```

Add tool:

```typescript
server.addTool({
  name: 'update_category_budget',
  description: `Update the budgeted amount for a category in a specific month.

Use this to allocate funds to categories or move money between categories.

**Parameters:**

budget - Which budget (uses default if omitted)

month (required) - Budget month in ISO format (first of month, e.g., "2026-01-01")

category (required) - Category selector {"name": "..."} or {"id": "..."}

budgeted (required) - The total amount to budget (in currency units)
  - This SETS the total, not an increment
  - Example: 500 to budget $500 total

**Examples:**

Set Groceries budget to $600:
  {
    "month": "2026-01-01",
    "category": {"name": "Groceries"},
    "budgeted": 600
  }

Fund emergency fund:
  {
    "month": "2026-01-01",
    "category": {"name": "Emergency Fund"},
    "budgeted": 1000
  }`,
  // ... implementation
});
```

**Effort:** Medium

---

### Phase 2: Medium Priority Features

#### 2.1 List Scheduled Transactions (`get_scheduled_transactions`)

**Implementation:**

Add to `ynab-client.ts`:

```typescript
async getScheduledTransactions(budgetId: string): Promise<EnrichedScheduledTransaction[]> {
  const api = this.getApi();
  const cache = await this.getBudgetCache(budgetId);

  const response = await api.scheduledTransactions.getScheduledTransactions(budgetId);

  return response.data.scheduled_transactions
    .filter(txn => !txn.deleted)
    .map(txn => ({
      id: txn.id,
      date_first: txn.date_first,
      date_next: txn.date_next,
      frequency: txn.frequency,
      amount: txn.amount,
      amount_currency: this.toCurrency(txn.amount, cache.currencyFormat),
      memo: txn.memo ?? null,
      flag_color: txn.flag_color ?? null,
      account_id: txn.account_id,
      account_name: txn.account_name,
      payee_id: txn.payee_id ?? null,
      payee_name: txn.payee_name ?? null,
      category_id: txn.category_id ?? null,
      category_name: txn.category_name ?? null,
    }));
}
```

**Effort:** Low

---

#### 2.2 List Months (`get_months`)

**Implementation:**

```typescript
async getBudgetMonths(budgetId: string): Promise<MonthSummary[]> {
  const api = this.getApi();
  const response = await api.months.getBudgetMonths(budgetId);

  return response.data.months.map(month => ({
    month: month.month,
    note: month.note ?? null,
    income: month.income,
    income_currency: this.toCurrency(month.income, null), // Use default 2 decimals
    budgeted: month.budgeted,
    activity: month.activity,
    to_be_budgeted: month.to_be_budgeted,
    age_of_money: month.age_of_money ?? null,
  }));
}
```

**Effort:** Low

---

#### 2.3 Import Transactions (`import_transactions`)

**Implementation:**

```typescript
async importTransactions(budgetId: string): Promise<{
  transaction_ids: string[];
  imported_count: number;
}> {
  const api = this.getApi();
  const response = await api.transactions.importTransactions(budgetId);

  return {
    transaction_ids: response.data.transaction_ids,
    imported_count: response.data.transaction_ids.length,
  };
}
```

**Effort:** Low

---

#### 2.4 Delete Transaction (`delete_transaction`)

**Implementation:**

```typescript
async deleteTransaction(budgetId: string, transactionId: string): Promise<{
  deleted_id: string;
}> {
  const api = this.getApi();
  const response = await api.transactions.deleteTransaction(budgetId, transactionId);

  return {
    deleted_id: response.data.transaction.id,
  };
}
```

**Effort:** Low

---

### Phase 3: Enhancements

#### 3.1 YNAB_BUDGET_ID Environment Variable

Add support for default budget ID via environment variable.

**In `ynab-client.ts` resolveBudgetId:**

```typescript
async resolveBudgetId(selector?: BudgetSelector): Promise<string> {
  // Check env var if no selector
  const hasName = selector?.name !== undefined && selector.name !== '';
  const hasId = selector?.id !== undefined && selector.id !== '';

  if (selector === undefined || (!hasName && !hasId)) {
    // Check for env var default
    const envBudgetId = process.env['YNAB_BUDGET_ID'];
    if (envBudgetId !== undefined && envBudgetId !== '') {
      // Validate it exists
      const budgets = await this.getBudgets();
      const budget = budgets.find(b => b.id === envBudgetId);
      if (budget !== undefined) {
        this.lastUsedBudgetId = budget.id;
        return budget.id;
      }
      // If not found, continue to normal resolution
    }

    // ... existing logic
  }
}
```

**Effort:** Low

---

#### 3.2 Enhanced update_transactions

Add support for updating more transaction fields:

- `date` - Move transaction to different date
- `amount` - Change amount
- `account_id` - Move to different account
- `payee_id` / `payee_name` - Change payee

This matches the reference project's `UpdateTransactionTool` capabilities.

**Effort:** Medium

---

## New Types to Add

```typescript
// src/types.ts additions

export interface EnrichedScheduledTransaction {
  id: string;
  date_first: string;
  date_next: string;
  frequency: string;
  amount: number;
  amount_currency: number;
  memo: string | null;
  flag_color: string | null;
  account_id: string;
  account_name: string;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
}

export interface MonthSummary {
  month: string;
  note: string | null;
  income: number;
  income_currency: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  age_of_money: number | null;
}

export interface BudgetMonthDetail {
  month: string;
  income: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  age_of_money: number | null;
  categories: EnrichedCategory[];
}

export interface CategorySelector {
  id?: string;
  name?: string;
}

export interface PayeeSelector {
  id?: string;
  name?: string;
}
```

---

## Implementation Checklist

### Phase 1: High Priority

- [ ] `get_payees` tool

  - [ ] Add tool to server.ts
  - [ ] Add JMESPath support
  - [ ] Add tests

- [ ] `create_transaction` tool

  - [ ] Add `createTransaction()` to ynab-client.ts
  - [ ] Add tool to server.ts with selectors
  - [ ] Support payee by name or ID
  - [ ] Support category by name or ID
  - [ ] Add tests

- [ ] `get_budget_summary` tool

  - [ ] Add `getBudgetMonth()` to ynab-client.ts
  - [ ] Add tool to server.ts
  - [ ] Support "current" month
  - [ ] Add JMESPath support
  - [ ] Add tests

- [ ] `update_category_budget` tool
  - [ ] Add `updateCategoryBudget()` to ynab-client.ts
  - [ ] Add category selector support
  - [ ] Add tool to server.ts
  - [ ] Add tests

### Phase 2: Medium Priority

- [ ] `get_scheduled_transactions` tool

  - [ ] Add `getScheduledTransactions()` to ynab-client.ts
  - [ ] Add tool to server.ts
  - [ ] Add JMESPath support
  - [ ] Add tests

- [ ] `get_months` tool

  - [ ] Add `getBudgetMonths()` to ynab-client.ts
  - [ ] Add tool to server.ts
  - [ ] Add JMESPath support
  - [ ] Add tests

- [ ] `import_transactions` tool

  - [ ] Add `importTransactions()` to ynab-client.ts
  - [ ] Add tool to server.ts
  - [ ] Add tests

- [ ] `delete_transaction` tool
  - [ ] Add `deleteTransaction()` to ynab-client.ts
  - [ ] Add tool to server.ts
  - [ ] Add tests

### Phase 3: Enhancements

- [ ] YNAB_BUDGET_ID environment variable support
- [ ] Enhanced `update_transactions` with date/amount/account/payee fields

---

## Summary

By implementing the Phase 1 features, ynab-mcp-deluxe will achieve **feature parity** with the reference project for the most important workflows:

1. **Transaction Management** - Query + Create + Update + Delete
2. **Budget Management** - View summaries + Allocate funds
3. **Reference Data** - Budgets, Accounts, Categories, Payees

Our project will **exceed** the reference project in:

1. **Querying Power** - JMESPath for complex filters/projections
2. **Categorization AI** - get_payee_history for pattern learning
3. **Developer Experience** - Smart selectors, dual amounts, caching

The full implementation across all phases would result in a comprehensive, best-in-class YNAB MCP server.
