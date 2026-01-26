# Add Subtransactions Support

## Date: 2026-01-26

## Goal

Add support for subtransactions (split transactions) when creating or updating transactions via the MCP server.

## YNAB API Analysis

From the OpenAPI spec, the YNAB API supports subtransactions as follows:

### SaveTransaction (for create)

- `subtransactions`: Optional array of `SaveSubTransaction`
- When provided, `category_id` should be `null` on the parent
- The sum of subtransaction amounts must equal the parent amount

### SaveSubTransaction

- `amount` (required): Milliunits
- `payee_id` (optional): UUID
- `payee_name` (optional): Creates payee if not found
- `category_id` (optional): UUID
- `memo` (optional): String, max 500 chars

### Limitations

- **Updating subtransactions on existing split transactions is NOT supported by YNAB API**
- Can only add subtransactions when creating NEW transactions or converting non-split to split

## Implementation Plan

### 1. Types (types.ts)

- [x] Add `SubtransactionInput` interface
- [x] Add `subtransactions?: SubtransactionInput[]` to `CreateTransactionInput`
- [x] Add `subtransactions?: SubtransactionInput[]` to `TransactionUpdate` (with docs about limitation)

### 2. Server Schemas (server.ts)

- [x] Add `SubtransactionInputSchema` Zod schema
- [x] Update `TransactionInputSchema` to include subtransactions
- [x] Update update_transactions schema to include subtransactions
- [x] Update tool descriptions to document the feature

### 3. YNAB Client (ynab-client.ts)

- [x] Update `createTransactions` to pass subtransactions to API
- [x] Update `updateTransactions` to pass subtransactions to API

### 4. Testing

- [ ] Test creating a split transaction
- [ ] Test that subtransaction amounts sum correctly
- [ ] Verify error handling for invalid subtransactions

## API Design

### Subtransaction Input

```typescript
interface SubtransactionInput {
  amount: number; // Required, milliunits
  category?: CategorySelector; // Optional, can use name or id
  payee?: PayeeSelector; // Optional, can use name or id
  memo?: string; // Optional
}
```

### Example Usage - Create Split Transaction

```json
{
  "transactions": [
    {
      "account": {"name": "Checking"},
      "date": "2026-01-26",
      "amount": -10000,
      "payee": {"name": "Target"},
      "subtransactions": [
        {"amount": -5000, "category": {"name": "Groceries"}},
        {"amount": -3000, "category": {"name": "Household"}},
        {"amount": -2000, "category": {"name": "Entertainment"}}
      ]
    }
  ]
}
```

Note: When subtransactions are provided, the parent's `category` is ignored (set to null).

## Progress

- [x] Research YNAB API subtransaction support
- [x] Create implementation plan
- [x] Implement types changes
- [x] Implement server.ts changes
- [x] Implement ynab-client.ts changes
- [x] Run signal check
- [ ] Test with YNAB API
- [x] Commit changes
