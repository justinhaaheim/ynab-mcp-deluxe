# YNAB Workflows & MCP Server Design Analysis

**Date:** 2026-01-19
**Purpose:** Comprehensive analysis of YNAB workflows for LLM assistant integration and MCP server design

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Understanding YNAB](#understanding-ynab)
   - [The Four Rules](#the-four-rules)
   - [Core Concepts](#core-concepts)
   - [Account Types](#account-types)
3. [Critical Workflows](#critical-workflows)
   - [Reconciliation (Detailed)](#reconciliation-detailed)
   - [Transaction Categorization](#transaction-categorization)
   - [Budget Catch-Up](#budget-catch-up)
   - [Credit Card Management](#credit-card-management)
   - [Handling Overspending](#handling-overspending)
4. [YNAB API Capabilities](#ynab-api-capabilities)
   - [Endpoints Overview](#endpoints-overview)
   - [Data Models](#data-models)
   - [Limitations & Rate Limits](#limitations--rate-limits)
5. [Existing MCP Server Landscape](#existing-mcp-server-landscape)
6. [Proposed MCP Server Design](#proposed-mcp-server-design)
   - [Design Principles](#design-principles)
   - [Core Tools](#core-tools)
   - [Reconciliation-Specific Tools](#reconciliation-specific-tools)
   - [Categorization-Specific Tools](#categorization-specific-tools)
   - [Budget Catch-Up Tools](#budget-catch-up-tools)
   - [Batch Processing & Token Optimization](#batch-processing--token-optimization)
7. [Workflow Automation Strategies](#workflow-automation-strategies)
8. [Additional Recommendations](#additional-recommendations)
9. [Sources](#sources)

---

## Executive Summary

This document provides a comprehensive analysis of YNAB (You Need A Budget) workflows, with particular focus on reconciliation, transaction categorization, and budget catch-up processes. The goal is to inform the design of an MCP (Model Context Protocol) server that enables an LLM assistant to be maximally helpful in automating and assisting with these workflows.

**Key Insights:**

- Reconciliation is the most critical workflow for maintaining budget integrity
- The YNAB API supports delta requests, enabling efficient incremental syncing
- Existing MCP servers provide basic functionality but lack sophisticated reconciliation assistance
- An optimal MCP server should perform heavy lifting (comparison, matching, batching) to minimize LLM token consumption
- Transaction categorization is a natural fit for LLM assistance given pattern recognition capabilities

---

## Understanding YNAB

### The Four Rules

YNAB is built on a zero-based budgeting methodology with four foundational rules:

#### Rule 1: Give Every Dollar a Job

Every dollar you have (right now, not projected future income) must be assigned to a specific category. This creates intentionality in spending and eliminates the disconnect between having money and knowing what it's for.

**Implication for LLM Assistant:** The assistant should help users understand their "Ready to Assign" balance and suggest category allocations based on priorities and spending patterns.

#### Rule 2: Embrace Your True Expenses

Large, infrequent expenses (annual subscriptions, car repairs, holiday shopping) should be broken into monthly funding targets. This transforms financial surprises into predictable monthly obligations.

**Implication for LLM Assistant:** The assistant can analyze transaction history to identify irregular expenses and suggest appropriate monthly funding targets.

#### Rule 3: Roll With the Punches

Budgets must be flexible. When overspending occurs, money should be moved from other categories rather than abandoning the budget. This is not failure—it's responsiveness to reality.

**Implication for LLM Assistant:** When detecting overspending, the assistant should suggest reallocation strategies from lower-priority categories.

#### Rule 4: Age Your Money

The goal is to spend money that is at least 30 days old, breaking the paycheck-to-paycheck cycle. YNAB tracks "money age" automatically.

**Implication for LLM Assistant:** The assistant can provide insights on money age trends and strategies for increasing it.

### Core Concepts

#### Ready to Assign

The amount of money available to budget, derived from account balances minus already-assigned amounts. This should always be $0 in an actively maintained budget.

#### Categories and Category Groups

Categories are organized into groups (e.g., "Monthly Bills", "Quality of Life", "Savings Goals"). Each category has:

- **Budgeted:** Amount assigned this month
- **Activity:** Spending/income this month
- **Available:** Current balance (can be negative)

#### Targets

Categories can have funding targets:

- **TB (Target Category Balance):** Maintain a specific balance
- **TBD (Target Category Balance by Date):** Reach a balance by a specific date
- **MF (Monthly Funding):** Fund a specific amount each month
- **NEED (Plan Your Spending):** Weekly/monthly/yearly spending targets
- **DEBT:** Debt payoff goals

#### Transaction States

- **Uncleared (gray "c"):** Not yet processed by bank (pending)
- **Cleared (green "c"):** Confirmed processed by bank
- **Reconciled (green lock):** Verified against bank statement, locked
- **Unapproved:** Imported but not reviewed by user

### Account Types

#### Budget Accounts (On-Budget)

- **Checking:** Primary transactional accounts
- **Savings:** On-budget savings (part of budgetable dollars)
- **Credit Cards:** Treated specially with automatic payment tracking
- **Cash:** Physical cash tracking

Budget accounts affect your "Ready to Assign" and require active categorization.

#### Tracking Accounts (Off-Budget)

- **Asset:** Investment accounts, 401(k), property values
- **Liability:** Mortgages, loans (when not using YNAB's loan feature)

Tracking accounts affect net worth but not the budget itself. They only need quarterly reconciliation.

#### Loan Accounts

Special account type for mortgages and loans with interest tracking, escrow, and payment scheduling.

---

## Critical Workflows

### Reconciliation (Detailed)

Reconciliation is the **most critical workflow** for maintaining budget accuracy. It ensures that YNAB reflects the actual state of your financial accounts.

#### What Reconciliation Accomplishes

1. **Balance Verification:** Confirms that YNAB's cleared balance matches the bank's cleared balance exactly
2. **Transaction Completeness:** Ensures all transactions in the bank are represented in YNAB
3. **Duplicate Detection:** Identifies and resolves duplicate entries
4. **Data Integrity:** Locks reconciled transactions to prevent accidental modification
5. **Performance:** Reduces loading times and prevents future duplicate imports

#### Why Balance Matching Alone is Insufficient

A critical insight: **matching balances does not guarantee completeness**. Consider:

- Account has 100 transactions
- YNAB is missing 10 transactions: 5 expenses totaling $500, 5 income totaling $500
- Net difference: $0
- **Balances match, but budget is inaccurate!**

The assistant must verify **both:**

1. Cleared balances match
2. All individual transactions are present and correctly recorded

#### The Reconciliation Process

1. **Obtain Bank's Cleared Balance**

   - Log into bank
   - Find "current balance" or "cleared balance" (NOT pending)
   - Note: Some banks show "available balance" which includes credit limits—use cleared balance

2. **Compare with YNAB's Cleared Balance**

   - In YNAB, the cleared balance is shown in the account header
   - This includes only transactions marked as "cleared" (green c)

3. **If Balances Match:**

   - Click "Reconcile" in YNAB
   - All cleared transactions become "reconciled" (locked)
   - Process complete

4. **If Balances Don't Match:**

   - Calculate the discrepancy amount
   - Search for transactions matching the discrepancy
   - Check for:
     - Missing transactions
     - Duplicate transactions
     - Incorrect amounts
     - Transactions incorrectly marked as cleared/uncleared
   - Resolve discrepancies
   - Reconcile again

5. **Last Resort: Balance Adjustment**
   - If discrepancy cannot be found, YNAB can create an adjustment transaction
   - This should be rare and investigated

#### Transaction Comparison for Reconciliation

When comparing YNAB to bank transactions, match on:

| Field          | Priority | Notes                                     |
| -------------- | -------- | ----------------------------------------- |
| Date           | High     | Allow +/- 1-2 days for posting delays     |
| Amount         | Critical | Must match exactly (in milliunits)        |
| Payee          | Medium   | Names often differ (bank vs user-entered) |
| Cleared Status | High     | Pending in bank = uncleared in YNAB       |

#### Common Reconciliation Issues

1. **Pending Transactions**

   - Bank shows as pending → YNAB should be uncleared
   - Don't include in reconciliation

2. **Duplicate Imports**

   - Can occur when using both file import and direct import
   - Also when manually entering then importing
   - YNAB has built-in duplicate detection but it's not perfect

3. **Transaction Matching Failures**

   - YNAB cannot match two imported transactions together
   - YNAB cannot match two manually-entered transactions together
   - Must have one of each for auto-matching

4. **Amount Discrepancies**
   - Restaurant transactions may change when tip is added
   - Gas station pre-authorizations differ from final amount
   - Foreign currency conversions may differ

#### Reconciliation Frequency

- **Recommended:** Weekly
- **Minimum:** Bi-weekly or on paydays
- **Tracking Accounts:** Quarterly

The more frequently you reconcile, the easier it is to find discrepancies.

### Transaction Categorization

#### The Categorization Workflow

1. **Transaction Import/Entry**

   - Direct Import: Automatic from linked banks
   - File Import: Manual OFX/QFX/CSV upload
   - Manual Entry: User-typed transactions

2. **Review Unapproved Transactions**

   - Imported transactions are initially "unapproved"
   - Shown with an orange indicator
   - **Note:** Transactions affect the budget immediately, regardless of approval status. If categorized, they impact that category's balance. If uncategorized, their amount is deducted from "Ready to Assign."

3. **Assign Categories**

   - Select appropriate category from the budget
   - For split transactions, divide among multiple categories
   - YNAB learns from patterns and suggests categories for known payees

4. **Approve Transactions**
   - Confirms the transaction has been reviewed and is correct
   - Removes the "unapproved" indicator
   - Serves as a workflow checkpoint, not a budget activation step

#### Categorization Challenges

1. **New Payees**

   - No history for YNAB to suggest categories
   - Payee names from banks are often cryptic (e.g., "AMZN\*123ABC" vs "Amazon")

2. **Variable Category Transactions**

   - Same payee, different purposes (e.g., Target: groceries vs household)
   - Requires contextual decision-making

3. **Split Transactions**

   - Single purchase spanning multiple categories
   - Common at stores like Walmart, Costco, Target

4. **Bulk Categorization**
   - When catching up, hundreds of transactions may need categorization
   - Time-consuming and tedious

#### LLM Categorization Potential

An LLM assistant is well-suited for categorization because:

- Pattern recognition in payee names
- Context awareness from transaction history
- Natural language understanding of merchant types
- Ability to learn user preferences over time

### Budget Catch-Up

When a user has neglected their budget for days, weeks, months, or years, they need a systematic approach to restoration.

#### Fresh Start vs. Cleanup

**Fresh Start (YNAB Feature)**

- Creates a new budget with same categories and accounts
- Current balances carried over (for linked accounts)
- All historical transactions discarded
- Scheduled transactions preserved

**Best for:**

- Very long gaps (months to years)
- Major life changes (new job, marriage, etc.)
- Learning curves ("starting over")

**Cleanup (Manual Reconciliation)**

- Keep historical data
- Import missing transactions
- Reconcile each account
- Categorize outstanding transactions

**Best for:**

- Shorter gaps (days to weeks)
- Desire to maintain spending history
- Accurate historical reports needed

#### The Catch-Up Process

1. **Assessment Phase**

   - Determine gap duration
   - List all accounts needing attention
   - Gather bank statements for gap period

2. **Account-by-Account Reconciliation**

   - Start with most critical accounts (checking, main credit cards)
   - Import transactions for gap period
   - Reconcile to current balance

3. **Bulk Categorization**

   - Work through unapproved transactions
   - Use filters to group by payee or date
   - Leverage category suggestions

4. **Budget Adjustment**

   - Address overspending in past months
   - Allocate current funds appropriately
   - Set up targets for future

5. **Verification**
   - All accounts reconciled
   - Ready to Assign is $0
   - No unresolved overspending in current month

### Credit Card Management

#### How YNAB Handles Credit Cards

YNAB treats credit cards as a payment method, not a source of money. When you spend on a credit card:

1. Transaction is categorized (e.g., Dining Out: $50)
2. YNAB automatically moves $50 from "Dining Out" Available to "Credit Card Payment" Available
3. When you pay the card, record a transfer from checking to credit card
4. The payment comes from the accumulated "Credit Card Payment" amount

#### Credit Card Workflow Tasks

1. **Recording Purchases:** Enter transactions with correct categories
2. **Monitoring Payment Category:** Ensure sufficient funds for payment
3. **Recording Payments:** Transfer transactions between accounts
4. **Handling Interest/Fees:** Separate category for credit card costs
5. **Reconciliation:** Same process as other accounts

#### Debt Payoff

For users carrying balances:

- Set a debt payoff target
- YNAB tracks progress toward payoff
- Interest and fees complicate but don't break the system

### Handling Overspending

#### Types of Overspending

1. **Cash Overspending (Red)**

   - Spent more than available using cash/debit
   - Automatically deducted from next month's "Ready to Assign"
   - Should be covered immediately by moving money from other categories

2. **Credit Overspending (Yellow)**
   - Spent more than available using credit card
   - Creates debt if not covered
   - Shows as underfunded in Credit Card Payment category

#### Resolution Workflow

1. **Detect overspending** (negative Available balance)
2. **Identify source categories** with surplus funds
3. **Move money** to cover overspending
4. **Verify** Ready to Assign and category balances

---

## YNAB API Capabilities

### Endpoints Overview

| Category         | Endpoints                              | Key Operations                         |
| ---------------- | -------------------------------------- | -------------------------------------- |
| **User**         | `/user`                                | Get authenticated user info            |
| **Budgets**      | `/budgets`, `/budgets/{id}`            | List, get full export, settings        |
| **Accounts**     | `/budgets/{id}/accounts`               | List, create, get single               |
| **Categories**   | `/budgets/{id}/categories`             | List (grouped), update, month-specific |
| **Transactions** | `/budgets/{id}/transactions`           | List, create, update, delete, import   |
| **Scheduled**    | `/budgets/{id}/scheduled_transactions` | List, create, update, delete           |
| **Payees**       | `/budgets/{id}/payees`                 | List, update                           |
| **Months**       | `/budgets/{id}/months`                 | List budget months, get specific       |

### Data Models

#### Transaction Object

```
{
  id: string,
  date: string (ISO 8601),
  amount: number (milliunits),
  memo: string,
  cleared: "cleared" | "uncleared" | "reconciled",
  approved: boolean,
  flag_color: string,
  account_id: string,
  payee_id: string,
  category_id: string,
  transfer_account_id: string,
  import_id: string,
  subtransactions: array (for splits)
}
```

#### Account Object

```
{
  id: string,
  name: string,
  type: string,
  on_budget: boolean,
  closed: boolean,
  balance: number (milliunits),
  cleared_balance: number (milliunits),
  uncleared_balance: number (milliunits),
  transfer_payee_id: string,
  direct_import_linked: boolean,
  last_reconciled_at: datetime
}
```

#### Category Object

```
{
  id: string,
  category_group_id: string,
  name: string,
  budgeted: number (milliunits),
  activity: number (milliunits),
  balance: number (milliunits),
  goal_type: "TB" | "TBD" | "MF" | "NEED" | "DEBT",
  goal_target: number (milliunits),
  goal_percentage_complete: number
}
```

### Limitations & Rate Limits

- **Rate Limit:** 200 requests per hour per access token (rolling window)
- **Milliunits:** All currency values are in milliunits (1000 = $1.00)
- **Dates:** ISO 8601 format, UTC timezone
- **Delta Requests:** Use `last_knowledge_of_server` for incremental sync
- **Transaction Filters:** Supports `uncategorized` and `unapproved` type filters
- **Import IDs:** Format `YNAB:[amount]:[date]:[occurrence]` for deduplication

### Delta Requests (Critical for Efficiency)

The API supports requesting only changed entities:

```
GET /budgets/{id}/transactions?last_knowledge_of_server=12345
```

Response includes:

- Only transactions changed since server_knowledge 12345
- New `server_knowledge` value for next request

**This is essential for efficient MCP server design—avoid re-fetching unchanged data.**

---

## Existing MCP Server Landscape

Several YNAB MCP servers exist. Analysis of their capabilities:

### calebl/ynab-mcp-server

**Tools:** ListBudgets, BudgetSummary, GetUnapprovedTransactions, CreateTransaction, ApproveTransaction

**Strengths:** Basic functionality, clear security model
**Gaps:** No reconciliation support, limited transaction querying

### cinnes/ynab-mcp (Rust)

**Tools:** 16+ including get_budgets, get_accounts, get_categories, create_transaction, update_transaction, clear_transaction, approve_transaction, analyze_transactions, analyze_spending_by_category, get_transactions_by_date_range, set_category_budget, create_transfer, health_check, cache_management

**Strengths:** Comprehensive coverage, read-only mode, secure token storage
**Gaps:** No reconciliation comparison tools, no batch operations optimized for LLM token efficiency

### Common Limitations Across Existing Servers

1. **No reconciliation-specific tools** that compare YNAB data with external account data
2. **No batch categorization** with intelligent grouping
3. **No token-optimized summaries** for LLM consumption
4. **No progress tracking** for multi-step workflows
5. **No external data import** tools for reconciliation

---

## Proposed MCP Server Design

### Design Principles

1. **Server Does Heavy Lifting**

   - Complex comparisons happen in the MCP server, not the LLM
   - Pre-process and summarize data before sending to LLM
   - Return actionable insights, not raw data dumps

2. **Token Efficiency**

   - Paginated results with intelligent batching
   - Summary views before detail views
   - Delta-only updates when possible

3. **Workflow-Oriented**

   - Tools designed around complete workflows, not just API mapping
   - Multi-step operations where appropriate
   - Progress tracking and resumability

4. **Safe by Default**

   - Read operations should be easy and safe
   - Write operations should require explicit confirmation
   - Reconciliation adjustments require extra verification

5. **Flexible Data Input**
   - Accept external account data in multiple formats
   - Support for CSV, OFX, QFX parsing
   - Manual data entry support

### Core Tools

#### Budget & Account Tools

```
get_budget_summary
  Purpose: High-level overview of budget health
  Returns:
    - Ready to Assign amount
    - Number of underfunded categories
    - Number of overspent categories
    - Number of unapproved transactions
    - Account count with total balance
  Token Impact: Minimal (summary only)

get_account_status(account_id)
  Purpose: Account reconciliation readiness
  Returns:
    - Current cleared balance
    - Uncleared transaction count
    - Last reconciliation date
    - Pending transaction summary
  Token Impact: Low
```

#### Transaction Tools

```
get_transactions_requiring_attention(options)
  Purpose: Unified view of transactions needing action
  Options:
    - include_unapproved: boolean
    - include_uncategorized: boolean
    - include_uncleared: boolean
    - account_id: optional filter
    - date_range: optional filter
    - limit: pagination (default 50)
    - offset: pagination
  Returns:
    - Grouped by attention type
    - Summary counts
    - Paginated transaction list
  Token Impact: Medium (controlled by limit)

bulk_categorize_transactions(categorizations)
  Purpose: Categorize multiple transactions at once
  Input: Array of {transaction_id, category_id}
  Returns: Success/failure for each
  Token Impact: Low (confirmation only)

bulk_approve_transactions(transaction_ids)
  Purpose: Approve multiple transactions at once
  Returns: Success/failure count
  Token Impact: Minimal
```

### Reconciliation-Specific Tools

```
prepare_reconciliation(account_id, external_balance)
  Purpose: Set up reconciliation and identify discrepancies
  Input:
    - account_id: YNAB account to reconcile
    - external_balance: Bank's cleared balance (in milliunits)
  Processing:
    - Fetch all unreconciled cleared transactions
    - Calculate YNAB cleared balance
    - Compare with external balance
    - Identify potential matching issues
  Returns:
    - ynab_cleared_balance
    - external_balance
    - discrepancy (if any)
    - discrepancy_analysis: {
        possible_single_transactions: [...], // Transactions matching discrepancy
        possible_combinations: [...], // Transaction pairs/groups matching discrepancy
        uncleared_transactions_summary
      }
    - recommendation: "ready_to_reconcile" | "review_transactions" | "investigate_discrepancy"
  Token Impact: Medium

import_external_transactions(account_id, transactions_data, format)
  Purpose: Parse and prepare external transaction data for comparison
  Input:
    - account_id: Target YNAB account
    - transactions_data: Raw data from bank
    - format: "csv" | "ofx" | "qfx" | "json"
  Processing:
    - Parse the external data
    - Normalize date formats
    - Convert amounts to milliunits
    - Clean payee names
  Returns:
    - parsed_transactions: array
    - parse_errors: array (if any)
    - transaction_count
    - date_range
    - total_amount
  Token Impact: Low (summary + error info only, full data stored server-side)

compare_transactions(account_id, session_id)
  Purpose: Compare YNAB transactions with imported external transactions
  Input:
    - account_id: YNAB account
    - session_id: Reference to imported external data
  Processing:
    - Match transactions by amount + date (fuzzy)
    - Identify missing in YNAB
    - Identify missing in external (possible YNAB errors)
    - Identify potential duplicates
    - Score confidence of matches
  Returns:
    - matched_count
    - matched_transactions: [{ynab_id, external_ref, confidence}] (high confidence only)
    - missing_in_ynab: [{date, amount, payee}] (paginated)
    - missing_in_external: [{ynab_id, date, amount, payee}]
    - potential_duplicates: [{ynab_ids, reason}]
    - low_confidence_matches: [{ynab_id, external_ref, issues}]
  Token Impact: Medium (summaries and problem cases only)

create_missing_transactions(account_id, transactions)
  Purpose: Add transactions identified as missing from YNAB
  Input:
    - account_id: Target account
    - transactions: [{date, amount, payee, memo, category_id?}]
  Returns:
    - created_count
    - created_ids
    - errors (if any)
  Token Impact: Low

resolve_duplicate(ynab_transaction_id, action)
  Purpose: Handle identified duplicate transactions
  Input:
    - ynab_transaction_id: The duplicate to resolve
    - action: "delete" | "keep" | "merge_with:{other_id}"
  Returns:
    - success: boolean
    - resulting_transaction (if merged)
  Token Impact: Minimal

complete_reconciliation(account_id)
  Purpose: Finalize reconciliation after issues resolved
  Input:
    - account_id: Account to reconcile
  Processing:
    - Verify cleared balance matches last provided external balance
    - Lock all cleared transactions
    - Update last_reconciled_at
  Returns:
    - success: boolean
    - reconciled_transaction_count
    - new_reconciled_balance
  Token Impact: Minimal
```

### Categorization-Specific Tools

```
suggest_categories(transaction_ids)
  Purpose: Get AI-ready category suggestions
  Input:
    - transaction_ids: Transactions to analyze
  Processing:
    - Analyze payee names
    - Check historical patterns for payee
    - Consider transaction amounts
    - Look at similar transactions
  Returns:
    - suggestions: [{
        transaction_id,
        payee_name,
        amount,
        date,
        suggested_category: {id, name, confidence},
        alternative_categories: [{id, name, confidence}],
        historical_pattern: "always_X" | "usually_X" | "varies" | "unknown"
      }]
  Token Impact: Medium (rich context for LLM decision)

get_categories_for_selection
  Purpose: Provide category list for LLM to choose from
  Returns:
    - categories: [{
        id,
        name,
        group_name,
        available_balance,
        is_hidden,
        common_payees: [string] // Top payees typically assigned here
      }]
  Token Impact: Medium (but cacheable)

apply_categorization_rule(payee_pattern, category_id)
  Purpose: Set up auto-categorization for future
  Input:
    - payee_pattern: Regex or exact match
    - category_id: Target category
  Processing:
    - Save rule
    - Optionally apply to existing uncategorized
  Returns:
    - rule_id
    - applied_count (if retroactive)
  Token Impact: Low
```

### Budget Catch-Up Tools

```
assess_budget_state
  Purpose: Comprehensive status for catch-up planning
  Returns:
    - last_activity_date
    - accounts_status: [{
        id,
        name,
        type,
        last_reconciled,
        unreconciled_transaction_count,
        unapproved_count,
        potential_gap_months
      }]
    - categories_needing_attention: [{
        id,
        name,
        issue: "overspent" | "underfunded" | "no_target",
        amount
      }]
    - ready_to_assign
    - recommendation: "fresh_start" | "targeted_cleanup" | "full_reconciliation"
  Token Impact: Medium

generate_catch_up_plan(strategy)
  Purpose: Create actionable catch-up plan
  Input:
    - strategy: "quick" | "thorough" | "fresh_start"
  Returns:
    - steps: [{
        order,
        action,
        target,
        estimated_items,
        priority
      }]
    - warnings: [string]
  Token Impact: Low

get_month_summary(month)
  Purpose: Quick view of a specific month's state
  Input:
    - month: YYYY-MM
  Returns:
    - income
    - expenses
    - overspending_total
    - categories_overspent: [{name, amount}]
    - ready_to_assign_that_month
  Token Impact: Low
```

### Batch Processing & Token Optimization

```
get_paginated_results(query_id, page)
  Purpose: Retrieve additional pages from previous queries
  Input:
    - query_id: Reference from initial query
    - page: Page number
  Returns:
    - Appropriate page of results
    - has_more: boolean
  Token Impact: Controlled

get_summary_only(operation, params)
  Purpose: Get counts/summaries without full data
  Input:
    - operation: "unapproved" | "uncategorized" | "unreconciled"
    - params: Filters
  Returns:
    - count
    - amount_total
    - date_range
    - top_payees (if relevant)
  Token Impact: Minimal

create_session(workflow_type)
  Purpose: Initialize a multi-step workflow
  Input:
    - workflow_type: "reconciliation" | "catch_up" | "categorization"
  Returns:
    - session_id
    - expires_at
    - workflow_steps
  Token Impact: Minimal

get_session_state(session_id)
  Purpose: Resume workflow after interruption
  Input:
    - session_id: Previous session
  Returns:
    - workflow_type
    - current_step
    - completed_steps
    - pending_actions
    - stored_data_summary
  Token Impact: Low
```

---

## Workflow Automation Strategies

### Reconciliation Workflow (LLM-Assisted)

```
Step 1: User provides account and bank balance
  LLM: "Let's reconcile your Chase checking. What's your current cleared balance from the bank?"
  User: "$3,245.67"

Step 2: MCP Server compares balances
  Tool: prepare_reconciliation(account_id="chase-123", external_balance=3245670)
  Result: discrepancy=-$45.00, possible_single_transactions=[tx_a, tx_b]

Step 3: LLM interprets and guides
  LLM: "There's a $45 discrepancy. I found two transactions that could explain this:
        - $45 at Starbucks on Jan 15 (not in your bank yet?)
        - -$45 refund from Amazon on Jan 10
        Should I check if either of these should be uncleared, or would you like to import your bank transactions for detailed comparison?"

Step 4: User decides
  User: "Import my transactions" [provides CSV]

Step 5: MCP Server processes
  Tool: import_external_transactions(account_id, csv_data, "csv")
  Tool: compare_transactions(account_id, session_id)
  Result: missing_in_ynab=[{$25, "ATM Withdrawal", Jan 12}]

Step 6: LLM resolves
  LLM: "Found one missing transaction: $25 ATM withdrawal on Jan 12. Should I add this and categorize it?"

Step 7: Complete
  Tool: create_missing_transactions(...)
  Tool: complete_reconciliation(account_id)
```

### Categorization Workflow (LLM-Assisted)

```
Step 1: Get uncategorized summary
  Tool: get_summary_only("uncategorized", {})
  Result: count=47, top_payees=["AMZN", "TARGET", "UNKNOWN MERCHANT"]

Step 2: Get batch with suggestions
  Tool: suggest_categories(transaction_ids=[first 10])
  Result: Detailed suggestions with confidence scores

Step 3: LLM processes and batches
  For high-confidence (>90%): "These 6 transactions have clear categories. Approve?"
  For medium (60-90%): "These look like groceries based on Target history. Confirm?"
  For low (<60%): "Not sure about 'UNKNOWN MERCHANT $47.32' - what was this purchase?"

Step 4: Bulk apply
  Tool: bulk_categorize_transactions([...confirmed categorizations])

Step 5: Repeat for remaining
```

### Catch-Up Workflow (LLM-Assisted)

```
Step 1: Assess state
  Tool: assess_budget_state()
  Result: 3 months gap, 234 unapproved transactions, Chase and Amex need reconciliation

Step 2: Generate plan
  Tool: generate_catch_up_plan("thorough")
  Result:
    1. Reconcile Chase (most transactions)
    2. Reconcile Amex
    3. Categorize transactions by month, oldest first
    4. Address overspending in October, November
    5. Budget current month

Step 3: LLM guides through each step
  "Let's start with Chase. Can you download your Chase transactions for October through today?"

Step 4: Execute each phase
  [Reconciliation workflow for Chase]
  [Reconciliation workflow for Amex]
  [Categorization workflow for batches]

Step 5: Finalize
  "Budget is caught up! All accounts reconciled. 234 transactions categorized.
   October had $150 overspending (absorbed into November).
   Ready to Assign is $0. You're all set!"
```

---

## Additional Recommendations

### Smart Defaults and Learning

1. **Category Prediction Model**

   - Store user corrections to improve suggestions
   - Weight recent history higher
   - Support payee name normalization rules

2. **Schedule Awareness**

   - Know when bills are due
   - Predict expected transactions
   - Alert on missed recurring transactions

3. **Anomaly Detection**
   - Flag unusually large transactions
   - Identify potential fraud
   - Notice missing expected deposits

### Enhanced Reconciliation Features

1. **Fuzzy Date Matching**

   - Allow configurable tolerance (1-5 days)
   - Account for weekend posting delays
   - Handle timezone differences

2. **Payee Normalization**

   - Map bank payee names to YNAB payees
   - "AMZN MKTP\*123ABC" → "Amazon"
   - User-trainable mappings

3. **Split Transaction Assistance**
   - When external shows one transaction but YNAB shows split
   - Help reconcile these cases
   - Suggest common splits based on history

### Reporting and Insights

1. **Reconciliation History**

   - Track reconciliation frequency
   - Note common discrepancy causes
   - Suggest process improvements

2. **Spending Analysis**

   - Monthly trends by category
   - Category comparison to targets
   - Unusual spending alerts

3. **Budget Health Score**
   - Composite metric of:
     - Reconciliation recency
     - Categorization completeness
     - Target adherence
     - Money age

### Integration Ideas (Future Exploration)

1. **Multi-Account Reconciliation**

   - Reconcile all accounts in sequence
   - Handle transfers between accounts
   - Global balance verification

2. **Goal Progress Tracking**

   - Natural language goal queries
   - Projections based on current trajectory
   - Adjustment suggestions

3. **Financial Calendar**

   - Visualize upcoming scheduled transactions
   - Bill due date reminders
   - Low balance predictions

4. **Export and Backup**
   - Full budget export
   - Custom report generation
   - Data migration tools

---

## Sources

### Official YNAB Resources

- [The YNAB Method](https://www.ynab.com/ynab-method)
- [The Four Rules](https://www.ynab.com/the-four-rules)
- [YNAB API Documentation](https://api.ynab.com/)
- [Reconciling Accounts Guide](https://support.ynab.com/en_us/reconciling-accounts-a-guide-BJFE3fHys)
- [Getting Started with Reconciliation](https://support.ynab.com/en_us/getting-started-with-reconciling-accounts-an-overview-Sy3JWx4Js)
- [Categorizing Transactions](https://support.ynab.com/en_us/categorizing-transactions-a-guide-HyRl60sks)
- [Approving and Matching Transactions](https://support.ynab.com/en_us/approving-and-matching-transactions-a-guide-ByYNZaQ1i)
- [File-Based Import](https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo)
- [Fresh Start Guide](https://support.ynab.com/en_us/making-a-fresh-start-a-guide-HkXYR_c0q)
- [Handling Overspending](https://support.ynab.com/en_us/overspending-in-ynab-a-guide-ryWoxEyi)
- [Credit Card Payments](https://support.ynab.com/en_us/credit-card-payments-a-guide-r1_506Q1j)
- [Account Types Overview](https://support.ynab.com/en_us/account-types-an-overview-BkmGM0qCq)
- [8 Myths About Reconciliation](https://www.ynab.com/blog/8-myths-about-reconciliation-in-ynab)

### Third-Party Resources

- [YNAB_GPT - Auto-Categorization](https://github.com/aelzeiny/YNAB_GPT)
- [n8n YNAB Categorization Workflow](https://n8n.io/workflows/7566-auto-categorize-ynab-transactions-with-gpt-5-mini-and-discord-notifications/)
- [Toolkit for YNAB](https://github.com/toolkit-for-ynab/toolkit-for-ynab)
- [ReconCLI for YNAB](https://github.com/olexs/reconcli-for-ynab)
- [How Tracking Accounts Work](https://www.ynab.com/blog/the-how-and-why-of-tracking-accounts)

### Existing MCP Servers

- [calebl/ynab-mcp-server](https://github.com/calebl/ynab-mcp-server)
- [EthanKang1/ynab-mcp](https://github.com/EthanKang1/ynab-mcp)
- [cinnes/ynab-mcp](https://github.com/cinnes/ynab-mcp)
- [mattweg/ynab-mcp](https://github.com/mattweg/ynab-mcp)
- [roeeyn/ynab-mcp-server](https://github.com/roeeyn/ynab-mcp-server)
- [klauern/mcp-ynab](https://glama.ai/mcp/servers/@klauern/mcp-ynab)

### API References

- [YNAB SDK Ruby OpenAPI Spec](https://github.com/ynab/ynab-sdk-ruby/blob/main/open_api_spec.yaml)
- [YNAB API v1 Endpoints](https://api.ynab.com/v1)

---

## Appendix: Currency Conversion Reference

YNAB uses "milliunits" for all currency amounts:

| Dollars | Milliunits |
| ------- | ---------- |
| $1.00   | 1,000      |
| $10.00  | 10,000     |
| $100.00 | 100,000    |
| -$45.67 | -45,670    |

**Conversion:**

- To milliunits: `dollars * 1000`
- To dollars: `milliunits / 1000`

---

## Appendix: Transaction Status Reference

| Status     | UI Indicator     | Meaning                   | Include in Reconciliation? |
| ---------- | ---------------- | ------------------------- | -------------------------- |
| Uncleared  | Gray "c"         | Not yet processed by bank | No                         |
| Cleared    | Green "c"        | Confirmed by bank         | Yes                        |
| Reconciled | Green lock       | Previously reconciled     | Already included           |
| Unapproved | Orange indicator | Needs user review         | Depends on cleared status  |

---

_Document created for YNAB LLM Assistant project. Last updated: 2026-01-29_
