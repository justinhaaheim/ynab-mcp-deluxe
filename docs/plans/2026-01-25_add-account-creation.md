# Add Account Creation to MCP Server

## Overview

Add the ability to create accounts via the MCP server.

**Important finding:** The YNAB API does **NOT** support creating categories programmatically. Only account creation is available.

## YNAB API Capabilities

### Account Creation ✅ SUPPORTED

**Endpoint:** `POST /budgets/{budget_id}/accounts`

**Required parameters:**
- `name` (string) - Account name
- `type` (AccountType) - One of: checking, savings, cash, creditCard, lineOfCredit, otherAsset, otherLiability, mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt
- `balance` (integer) - Opening balance in milliunits (1000 milliunits = $1.00)

### Category Creation ❌ NOT SUPPORTED

The YNAB API only supports PATCH operations on existing categories (update name, note, category_group_id, or monthly budgeted amount). There is no POST endpoint for creating categories.

## Implementation Plan

### 1. Add `createAccount` method to `ynab-client.ts`

```typescript
async createAccount(
  budgetId: string,
  name: string,
  type: AccountType,
  balance: number
): Promise<Account>
```

- Call `POST /budgets/{budget_id}/accounts`
- Invalidate cache after creation
- Return the created account

### 2. Add `create_account` tool to `server.ts`

```typescript
server.addTool({
  name: 'create_account',
  description: 'Create a new account in YNAB...',
  annotations: {
    readOnlyHint: false,  // Write operation
  },
  parameters: z.object({
    budget: BudgetSelectorSchema,
    name: z.string().describe('Account name'),
    type: z.enum([...accountTypes]).describe('Account type'),
    balance: z.number().int().describe('Opening balance in milliunits'),
  }),
  execute: async (args, {log}) => { ... }
})
```

### 3. Add mock handler for testing

Update `src/mocks/handlers.ts` to handle `POST /budgets/:budgetId/accounts` with realistic mock response.

### 4. Add tests

Add tests for:
- Creating account with valid parameters
- Error handling for invalid account type
- Cache invalidation after creation

## Files to modify

1. `src/ynab-client.ts` - Add `createAccount` method
2. `src/server.ts` - Add `create_account` tool
3. `src/mocks/handlers.ts` - Add/verify mock handler
4. `src/server.test.ts` - Add tests

## Progress

- [ ] Add `createAccount` to ynab-client.ts
- [ ] Add `create_account` tool to server.ts
- [ ] Verify/add mock handler
- [ ] Add tests
- [ ] Run signal check
- [ ] Commit
