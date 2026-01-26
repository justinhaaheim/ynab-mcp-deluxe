# Add Split Transactions Support

## Overview
Add support for subtransactions (split transactions) when creating or updating transactions.

## Key Findings from Research

### YNAB API SaveSubTransaction Schema
Required:
- `amount` (integer, int64) - The subtransaction amount in milliunits format

Optional:
- `payee_id` (string, uuid, nullable) - The payee for the subtransaction
- `payee_name` (string, max 200, nullable) - The payee name (resolved similar to parent transaction)
- `category_id` (string, uuid, nullable) - The category for the subtransaction
- `memo` (string, max 500, nullable)

### Important Constraints
1. **For split transactions**: Set parent transaction's `category_id` to `null` and provide `subtransactions` array
2. **Subtransaction amounts must sum to parent amount**
3. **Update behavior**: Subtransactions are **overwritten entirely** when updating, not merged
4. **Cannot add splits to existing non-split transactions via update** (per search results, though we should verify)

## Implementation Plan

### 1. Add Types (src/types.ts)
- Add `CreateSubTransactionInput` interface for subtransaction creation
- Update `CreateTransactionInput` to include optional `subtransactions` array
- Add `UpdateSubTransactionInput` for updating (if supported)
- Update `TransactionUpdate` to include optional `subtransactions` array

### 2. Update Zod Schemas (src/server.ts)
- Create `SubTransactionInputSchema` for subtransactions in create/update
- Update `TransactionInputSchema` to include optional `subtransactions` array
- Update the update_transactions schema similarly

### 3. Update ynab-client.ts
- Modify `createTransactions` to pass subtransactions to API
- Modify `updateTransactions` to pass subtransactions to API
- Handle category/payee selector resolution for subtransactions

### 4. Update Tool Descriptions
- Update `create_transactions` description to explain split transactions
- Update `update_transactions` description to explain subtransaction handling
- Include clear examples of split transaction creation

## Files to Modify
1. `src/types.ts` - Add subtransaction input types
2. `src/server.ts` - Add schemas and update tool descriptions
3. `src/ynab-client.ts` - Handle subtransactions in create/update logic

## Status
- [x] Research YNAB API subtransaction structure
- [ ] Update types
- [ ] Update Zod schemas
- [ ] Update ynab-client
- [ ] Update tool descriptions with examples
- [ ] Run signal check
- [ ] Test
