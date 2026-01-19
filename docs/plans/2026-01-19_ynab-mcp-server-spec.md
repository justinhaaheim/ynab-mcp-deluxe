# YNAB MCP Server Specification

## Overview

A Model Context Protocol (MCP) server that provides access to the YNAB (You Need A Budget) API via stdio transport. Built in TypeScript, using JMESPath for flexible querying.

**Primary use case:** Claude-assisted transaction categorization for catching up on months of uncategorized transactions.

**Key design principles:**

- Sensible defaults that minimize required parameters for common queries
- Enriched responses with human-readable names (not just UUIDs)
- JMESPath for advanced filtering, sorting, and projection
- Both raw milliunits and currency-formatted amounts for flexibility
- Bulk operations for efficient updates

---

## Implementation Notes

### Dependencies

```json
{
  "dependencies": {
    "ynab": "^2.x",
    "@anthropic-ai/sdk": "^0.x",
    "@metrichor/jmespath": "^0.x"
  }
}
```

### YNAB Package

Use the official `ynab` npm package which is generated from the OpenAPI spec:

- Provides typed API client
- Includes `convertMilliUnitsToCurrencyAmount(milliunits, format)` helper
- Handles authentication via Personal Access Token

### Authentication

YNAB API uses a Personal Access Token passed as Bearer token. The MCP server should:

- Accept token via environment variable `YNAB_ACCESS_TOKEN`
- Validate token on startup by fetching user info

---

## Data Models

### EnrichedTransaction

The core transaction model with both IDs (for API operations) and resolved names (for LLM reasoning).

```typescript
interface EnrichedTransaction {
  // Identifiers (preserved for API operations)
  id: string;
  account_id: string;
  payee_id: string | null;
  category_id: string | null;
  transfer_account_id: string | null;

  // Resolved names (for LLM reasoning)
  account_name: string;
  payee_name: string | null; // Resolved from payee_id or import_payee_name
  category_name: string | null; // null if uncategorized
  category_group_name: string | null; // Parent group name

  // Transaction details
  date: string; // ISO format "2025-01-15"
  amount: number; // Milliunits (integer, source of truth)
  amount_currency: number; // Currency amount (e.g., -45.99 for USD)
  memo: string | null;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  approved: boolean;
  flag_color: string | null;

  // Import metadata (useful for pattern matching)
  import_id: string | null;
  import_payee_name: string | null;
  import_payee_name_original: string | null;

  // Subtransactions (for split transactions)
  subtransactions: EnrichedSubTransaction[];
}

interface EnrichedSubTransaction {
  id: string;
  transaction_id: string;
  amount: number; // Milliunits
  amount_currency: number; // Currency amount
  memo: string | null;
  category_id: string | null;
  category_name: string | null;
  category_group_name: string | null;
}
```

### Category

```typescript
interface Category {
  id: string;
  name: string;
  category_group_id: string;
  category_group_name: string;
  hidden: boolean;
  deleted: boolean;
  // Budget amounts (optional, included when relevant)
  budgeted?: number;
  activity?: number;
  balance?: number;
}
```

### Account

```typescript
interface Account {
  id: string;
  name: string;
  type: string; // "checking", "creditCard", etc.
  on_budget: boolean;
  closed: boolean;
  balance: number; // Milliunits
  balance_currency: number; // Currency amount
}
```

### Payee

```typescript
interface Payee {
  id: string;
  name: string;
  transfer_account_id: string | null; // Non-null if this is a transfer payee
}
```

### Budget

```typescript
interface BudgetSummary {
  id: string;
  name: string;
  last_modified_on: string; // ISO datetime
  first_month: string; // "2018-04-01"
  last_month: string; // "2025-01-01"
  currency_format: {
    iso_code: string; // "USD", "EUR", etc.
    example_format: string; // "123,456.78"
    decimal_digits: number;
    decimal_separator: string;
    symbol_first: boolean;
    currency_symbol: string;
  };
}
```

---

## Tools

The server exposes 6 tools:

| Tool                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `get_budgets`         | List available budgets                               |
| `query_transactions`  | Flexible transaction querying with JMESPath          |
| `get_payee_history`   | Specialized lookup for payee categorization patterns |
| `get_categories`      | List all categories                                  |
| `get_accounts`        | List all accounts                                    |
| `update_transactions` | Bulk-update transactions                             |

---

### 1. get_budgets

List all budgets accessible to the authenticated user.

#### Input Schema

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

No parameters required.

#### Tool Description (for LLM)

```
List all YNAB budgets accessible to the authenticated user.

Returns budget names, IDs, currency, and date ranges. Call this first if you need to discover available budgets.

**Parameters:** None

**Example:**
  {}
```

#### Output

Returns array of BudgetSummary objects.

---

### 2. query_transactions

The primary tool for querying transactions. Supports filtering by status, account, date range, and payee, with JMESPath for advanced queries.

#### Default Behavior (when parameters are omitted)

| Aspect | Default                                                            |
| ------ | ------------------------------------------------------------------ |
| Budget | Last-used budget (or error if multiple budgets and none specified) |
| Status | All transactions                                                   |
| Sort   | Newest first (by date)                                             |
| Limit  | 50                                                                 |

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "budget": {
      "type": "object",
      "description": "Which budget to query. Required if user has multiple budgets.",
      "properties": {
        "name": {
          "type": "string",
          "description": "Budget name (case-insensitive)"
        },
        "id": {"type": "string", "description": "Exact budget ID"}
      },
      "additionalProperties": false
    },
    "status": {
      "type": "string",
      "enum": ["uncategorized", "unapproved", "all"],
      "default": "all",
      "description": "Filter by transaction status"
    },
    "account": {
      "type": "object",
      "description": "Filter to specific account",
      "properties": {
        "name": {
          "type": "string",
          "description": "Account name (case-insensitive)"
        },
        "id": {"type": "string", "description": "Exact account ID"}
      },
      "additionalProperties": false
    },
    "since_date": {
      "type": "string",
      "description": "Only transactions on or after this date (ISO format: YYYY-MM-DD)"
    },
    "until_date": {
      "type": "string",
      "description": "Only transactions on or before this date (ISO format: YYYY-MM-DD)"
    },
    "payee_contains": {
      "type": "string",
      "description": "Filter to transactions where payee name contains this string (case-insensitive)"
    },
    "sort_by": {
      "type": "string",
      "enum": ["newest", "oldest", "amount_desc", "amount_asc"],
      "default": "newest",
      "description": "Sort order. Ignored if 'query' includes sorting."
    },
    "query": {
      "type": "string",
      "description": "JMESPath expression for advanced filtering/projection. Applied after other filters."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "default": 50,
      "description": "Maximum results to return"
    }
  },
  "additionalProperties": false
}
```

#### Selector Validation

For `budget` and `account` selectors: must specify exactly one of `name` or `id`. If both or neither provided, return an error.

#### Processing Order

1. **Resolve budget** from selector (or use last-used)
2. **Fetch transactions** using YNAB API with pushed-down filters:
   - `type=uncategorized` or `type=unapproved` if applicable
   - `since_date` if provided
3. **Enrich transactions** with resolved names
4. **Apply additional filters** not supported by API:
   - `until_date`
   - `payee_contains`
   - `account` (if not using account-specific endpoint)
5. **Apply JMESPath** if `query` is provided
6. **Apply sort_by** only if `query` is NOT provided
7. **Apply limit**

#### Sort Implementations

| sort_by       | Behavior                                                                     |
| ------------- | ---------------------------------------------------------------------------- |
| `newest`      | By `date` descending (most recent first)                                     |
| `oldest`      | By `date` ascending                                                          |
| `amount_desc` | By `amount` descending (largest outflows first, since outflows are negative) |
| `amount_asc`  | By `amount` ascending (largest inflows first)                                |

#### Tool Description (for LLM)

```
Query transactions from YNAB with flexible filtering.

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
  {"status": "uncategorized", "query": "[?amount < `-100000` || amount > `100000`]"}

Just IDs and payees (minimal projection):
  {"query": "[*].{id: id, payee: payee_name, amount: amount_currency}"}

**Transaction fields available in JMESPath:**
- id, account_id, payee_id, category_id (identifiers)
- account_name, payee_name, category_name, category_group_name (resolved names)
- date, amount, amount_currency, memo, cleared, approved, flag_color
- import_id, import_payee_name, import_payee_name_original
- subtransactions (array, for split transactions)
```

#### Output

Returns array of EnrichedTransaction objects (or projected objects if JMESPath reshapes them).

---

### 3. get_payee_history

Specialized tool for understanding how a payee has been categorized historically. Critical for learning categorization patterns.

#### Input Schema

```json
{
  "type": "object",
  "required": ["payee"],
  "properties": {
    "budget": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "id": {"type": "string"}
      },
      "additionalProperties": false
    },
    "payee": {
      "type": "string",
      "description": "Payee name to search for (case-insensitive, partial match)"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "default": 100,
      "description": "Maximum transactions to analyze"
    },
    "query": {
      "type": "string",
      "description": "Optional JMESPath to filter/project the transactions array"
    }
  },
  "additionalProperties": false
}
```

#### Tool Description (for LLM)

```
Get historical categorization patterns for a payee.

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
- transactions: The actual historical transactions
```

#### Output

```json
{
  "payee_search": "starbucks",
  "total_matches": 47,
  "category_distribution": [
    {
      "category_name": "Coffee & Dining",
      "category_group_name": "Everyday Expenses",
      "count": 42,
      "percentage": 89.4
    },
    {
      "category_name": "Justin Discretionary",
      "category_group_name": "Discretionary",
      "count": 5,
      "percentage": 10.6
    }
  ],
  "transactions": [
    // EnrichedTransaction objects...
  ]
}
```

---

### 4. get_categories

List all categories, grouped by category group.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "budget": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "id": {"type": "string"}
      },
      "additionalProperties": false
    },
    "include_hidden": {
      "type": "boolean",
      "default": false,
      "description": "Include hidden categories"
    },
    "query": {
      "type": "string",
      "description": "Optional JMESPath expression"
    }
  },
  "additionalProperties": false
}
```

#### Tool Description (for LLM)

```
List all categories from a YNAB budget.

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
- categories: Array of {id, name, hidden, ...}
```

#### Output

Returns categories organized by group:

```json
[
  {
    "group_id": "...",
    "group_name": "Everyday Expenses",
    "categories": [
      {"id": "...", "name": "Groceries", "hidden": false},
      {"id": "...", "name": "Coffee & Dining", "hidden": false}
    ]
  }
  // ...
]
```

---

### 5. get_accounts

List all accounts.

#### Input Schema

```json
{
  "type": "object",
  "properties": {
    "budget": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "id": {"type": "string"}
      },
      "additionalProperties": false
    },
    "include_closed": {
      "type": "boolean",
      "default": false,
      "description": "Include closed accounts"
    },
    "query": {
      "type": "string",
      "description": "Optional JMESPath expression"
    }
  },
  "additionalProperties": false
}
```

#### Tool Description (for LLM)

```
List all accounts from a YNAB budget.

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
  {"query": "[?type == 'checking']"}
```

#### Output

Returns array of Account objects.

---

### 6. update_transactions

Bulk-update transactions. The critical write operation for syncing categorizations back to YNAB.

#### Input Schema

```json
{
  "type": "object",
  "required": ["transactions"],
  "properties": {
    "budget": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "id": {"type": "string"}
      },
      "additionalProperties": false
    },
    "transactions": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "type": "object",
        "required": ["id"],
        "properties": {
          "id": {
            "type": "string",
            "description": "Transaction ID to update"
          },
          "category_id": {
            "type": "string",
            "description": "New category ID"
          },
          "approved": {
            "type": "boolean",
            "description": "Set approval status"
          },
          "memo": {
            "type": "string",
            "description": "New memo text"
          },
          "flag_color": {
            "type": "string",
            "enum": [
              "red",
              "orange",
              "yellow",
              "green",
              "blue",
              "purple",
              null
            ],
            "description": "Flag color (null to clear)"
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

#### Tool Description (for LLM)

```
Update one or more transactions in YNAB.

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
Returns updated transactions and any failures with error messages.
```

#### Output

```json
{
  "updated": [
    // EnrichedTransaction objects for successfully updated transactions
  ],
  "failed": [{"id": "xyz789", "error": "Transaction not found"}]
}
```

#### Important Notes

- The YNAB API's PATCH endpoint supports bulk updates
- Updates are atomic per-transaction (partial failures possible)
- Only specified fields are changed; omitted fields are preserved
- Setting `category_id` does NOT automatically approve the transaction

---

## JMESPath Integration

### Package

Use `@metrichor/jmespath`:

```typescript
import jmespath from '@metrichor/jmespath';

function applyJMESPath<T>(data: T, query: string): unknown {
  return jmespath.search(data, query);
}
```

### Error Handling

If JMESPath compilation or evaluation fails, return a clear error:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Invalid JMESPath expression: Unexpected token at position 5. Expression: '[?amount = 100]'. Hint: Use '==' for equality, not '='."
    }
  ]
}
```

### Common JMESPath Patterns

For reference in tool descriptions:

```
# Filter by field value
[?category_name == 'Groceries']
[?approved == `false`]
[?amount < `-100000`]  # Outflows over $100

# String contains (case-sensitive)
[?contains(payee_name, 'Amazon')]

# Projection (select specific fields)
[*].{id: id, payee: payee_name, amount: amount_currency}

# Sorting
sort_by(@, &date)
reverse(sort_by(@, &date))

# Limiting
[:10]
reverse(sort_by(@, &amount))[:5]

# Combining
[?category_name == null] | sort_by(@, &date) | [:20]
```

---

## Error Handling

### Error Response Format

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Human-readable error message with actionable guidance"
    }
  ]
}
```

### Common Errors

| Situation                            | Message                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| No budget specified (multiple exist) | `Multiple budgets found. Please specify which budget using {"name": "..."} or {"id": "..."}. Available: Budget A, Budget B.` |
| Budget not found                     | `No budget found with name: 'Xyz'. Available budgets: Budget A, Budget B.`                                                   |
| Account not found                    | `No account found with name: 'Xyz'. Available accounts: Checking, Savings, Credit Card.`                                     |
| Category not found                   | `No category found with ID: 'abc123'.`                                                                                       |
| Transaction not found                | `Transaction not found: 'abc123'.`                                                                                           |
| Invalid selector                     | `Budget selector must specify exactly one of: 'name' or 'id'.`                                                               |
| Invalid JMESPath                     | `Invalid JMESPath expression: <parser error>. Expression: '<query>'.`                                                        |
| Rate limited                         | `YNAB API rate limit exceeded. Please wait before retrying.`                                                                 |
| Auth error                           | `YNAB authentication failed. Check that YNAB_ACCESS_TOKEN is valid.`                                                         |

---

## Currency Handling

### Converting Milliunits

Use the YNAB package's helper, passing the budget's currency format:

```typescript
import {utils} from 'ynab';

function enrichWithCurrency(
  amount: number,
  currencyFormat: CurrencyFormat,
): number {
  // convertMilliUnitsToCurrencyAmount returns a number
  return utils.convertMilliUnitsToCurrencyAmount(amount, currencyFormat);
}
```

### Response Format

All monetary amounts include both representations:

```json
{
  "amount": -45990, // Milliunits (integer, for precision)
  "amount_currency": -45.99 // Currency amount (for readability)
}
```

---

## Implementation Considerations

### Caching

Consider caching these relatively static resources:

- Budget list (refresh on explicit request or after updates)
- Categories (refresh after budget selection changes)
- Accounts (refresh after budget selection changes)
- Payees (can be large; refresh periodically)

### Delta Syncing

The YNAB API supports `last_knowledge_of_server` for efficient incremental updates. Consider:

- Storing server knowledge after each request
- Using delta sync for subsequent requests to the same budget
- Exposing this as an optional optimization (not required for v1)

### Rate Limiting

YNAB API has rate limits (200 requests per hour per access token). The MCP server should:

- Track request count
- Return informative errors when rate limited
- Consider request batching where possible

### Transaction Enrichment

Enrichment requires lookup maps for:

- `account_id` → `Account`
- `category_id` → `Category`
- `category.category_group_id` → `CategoryGroup`
- `payee_id` → `Payee`

Build these maps once per budget and cache them.

---

## Testing Considerations

### Test Mode

Consider a test mode that:

- Uses a dedicated test budget (if available)
- Prevents updates to production budgets
- Mocks API responses for unit testing

### Key Test Cases

**query_transactions:**

- [ ] Empty params returns transactions from default budget
- [ ] `status: "uncategorized"` filters correctly
- [ ] `status: "unapproved"` filters correctly
- [ ] `account: {name: "..."}` filters to that account
- [ ] `since_date` / `until_date` filter correctly
- [ ] `payee_contains` matches case-insensitively
- [ ] All `sort_by` options work correctly
- [ ] JMESPath filtering works
- [ ] JMESPath projection works
- [ ] `limit` is respected
- [ ] Multiple budgets require explicit budget selector

**get_payee_history:**

- [ ] Returns category distribution summary
- [ ] Partial payee name matching works
- [ ] Case-insensitive matching works
- [ ] Includes uncategorized in distribution

**get_categories:**

- [ ] Returns categories grouped by category group
- [ ] Hidden categories excluded by default
- [ ] `include_hidden: true` includes hidden

**get_accounts:**

- [ ] Returns all open accounts
- [ ] Closed accounts excluded by default
- [ ] `include_closed: true` includes closed

**update_transactions:**

- [ ] Single transaction update works
- [ ] Batch update works
- [ ] Partial failure handled correctly
- [ ] Category assignment works
- [ ] Approval works
- [ ] Memo update works
- [ ] Flag color works
- [ ] Invalid transaction ID returns helpful error

---

## Future Considerations

1. **Split transaction support**: Creating/editing subtransactions for split categorization

2. **Payee management**: Renaming payees, merging duplicates

3. **Scheduled transactions**: Querying and managing recurring transactions

4. **Budget amounts**: Reading/updating category budgeted amounts

5. **Reports**: Spending summaries, category totals over time

6. **Reconciliation**: Account reconciliation workflows

7. **Import**: Triggering transaction import from linked accounts

---

## Appendix: YNAB API Reference

Key endpoints used by this MCP server:

| MCP Tool              | YNAB API Endpoint(s)                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| `get_budgets`         | `GET /budgets`                                                                  |
| `query_transactions`  | `GET /budgets/{id}/transactions` with `type` and `since_date` params            |
| `get_payee_history`   | `GET /budgets/{id}/payees/{id}/transactions` or filtered from main transactions |
| `get_categories`      | `GET /budgets/{id}/categories`                                                  |
| `get_accounts`        | `GET /budgets/{id}/accounts`                                                    |
| `update_transactions` | `PATCH /budgets/{id}/transactions`                                              |

The full YNAB OpenAPI spec is available at: https://api.ynab.com/papi/open_api_spec.yaml
