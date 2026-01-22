# Consolidate create_transaction → create_transactions

**Date:** 2026-01-22
**Status:** Complete

## Goal

Replace `create_transaction` (singular) with `create_transactions` (plural) that accepts an array of 1-N transactions. This simplifies the API surface with no loss of functionality.

## Rationale

The YNAB API uses a single polymorphic endpoint that accepts either:

- `{ transaction: {...} }` for single creation
- `{ transactions: [...] }` for batch creation

A single-item array works fine, so there's no reason to maintain a separate single-transaction tool.

## Changes Made

### `src/ynab-client.ts`

- [x] Replaced `createTransaction()` with `createTransactions()`
- [x] Now uses `{ transactions: [...] }` format in API call
- [x] Returns `{ created: EnrichedTransaction[], duplicates: string[] }`

### `src/server.ts`

- [x] Renamed tool from `create_transaction` to `create_transactions`
- [x] Parameters now include `transactions` array (1-100 items)
- [x] Each transaction uses selectors (account, category, payee) for flexibility
- [x] Updated description and examples for batch usage

## Verification

- [x] `bun run signal` - All checks pass
- [x] `bun run test` - All 5 tests pass

## Next Steps

- Commit these changes
