# YNAB MCP Server Implementation Scratchpad

**Date:** 2026-01-19

## Overview

Implementing MCP server for YNAB following the spec in `2026-01-19_ynab-mcp-server-spec.md`.

## Architecture

```
src/
  server.ts      # Main MCP server - defines all 6 tools
  types.ts       # Type definitions (EnrichedTransaction, etc.)
  ynab-client.ts # YNAB API client wrapper with caching
  helpers.ts     # Helper functions (JMESPath, currency, etc.)
```

## Tools Implemented

1. [x] `get_budgets` - List available budgets
2. [x] `query_transactions` - Flexible transaction querying with JMESPath
3. [x] `get_payee_history` - Specialized lookup for payee categorization patterns
4. [x] `get_categories` - List all categories
5. [x] `get_accounts` - List all accounts
6. [x] `update_transactions` - Bulk-update transactions

## Key Implementation Notes

### YNAB Package

- Already includes `account_name`, `payee_name`, `category_name` on TransactionDetail
- Need to add `category_group_name` via enrichment
- Use `utils.convertMilliUnitsToCurrencyAmount(milliunits, decimalDigits)` for currency

### Caching Strategy

- Cache budgets, categories, accounts, payees per budget
- Build lookup maps on first access:
  - `categoryIdToCategory`
  - `categoryIdToGroupName`
  - `accountIdToAccount`
  - `payeeIdToPayee`

### JMESPath

- Use `@metrichor/jmespath` package
- Apply AFTER other filters
- If query is provided, skip `sort_by` (query handles its own sorting)

### Error Handling

- Use `isError: true` MCP response format for errors
- Provide actionable error messages

## Questions/Ambiguities

None identified during implementation.

## Progress Log

- Started implementation
- Installed dependencies (`ynab`, `@metrichor/jmespath`, `@types/node`)
- Explored YNAB package types
- Created `types.ts` with all data models
- Created `ynab-client.ts` with caching and enrichment
- Created `helpers.ts` with JMESPath, filtering, sorting utilities
- Implemented all 6 MCP tools in `server.ts`
- Fixed all TypeScript, ESLint, and Prettier issues
- All `bun run signal` checks pass

## Implementation Complete

The YNAB MCP server is fully implemented following the spec. Key features:

- **6 tools**: get_budgets, query_transactions, get_payee_history, get_categories, get_accounts, update_transactions
- **Enriched responses**: All transactions include resolved names (account_name, payee_name, category_name, category_group_name)
- **JMESPath support**: Flexible filtering and projection on all query tools
- **Caching**: Budget data (accounts, categories, payees) cached per budget
- **Currency handling**: Both milliunits and currency amounts included
- **Error handling**: Structured error responses with actionable messages
- **Sensible defaults**: Last-used budget, newest-first sorting, 50-item limit
