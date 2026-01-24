# ROADMAP

Project roadmap for ynab-mcp-deluxe.

## Current State

A working MCP server with 15 tools for YNAB budget management:

- Budget queries (transactions, categories, accounts, payees, months)
- Transaction management (create, update, delete, import)
- Budget allocation (update category budgets)
- Backup (manual and automatic on first tool call)

## Next Actions

1. **Add liberal debug logging** - Use FastMCP's context `log.debug()` throughout tool execution for better observability during development and testing
2. **Test backup-on-first-action flow** - Verify the automatic backup triggers correctly on first tool call
3. **Add more integration tests** - Cover remaining test gaps:
   - Read operations (getTransactions, getBudgets, getAccounts, etc.) - verify correct data transformation
   - Transaction filtering (date ranges, account filtering, category filtering)
   - Pagination - handling large result sets
   - Input validation - invalid parameters, malformed requests

## In Progress

- Integration test coverage (see `docs/plans/2026-01-22_integration-tests.md`)

## Future Enhancements

### OAuth Authentication

Currently using environment variable (`YNAB_ACCESS_TOKEN`) for API authentication. Would be valuable to support OAuth flow for:

- Better user experience (no manual token management)
- Token refresh handling
- Multi-user scenarios

FastMCP has built-in OAuth support with providers and PKCE - investigate using this.

### Resources

Expose budget data as MCP Resources for browsable access:

- Budget summaries
- Recent transactions
- Category balances
- Account balances

This would allow clients to browse data without explicit tool calls.

### Progress Reporting

Use FastMCP's `reportProgress()` for long-running operations:

- Backing up multiple budgets
- Large transaction queries
- Bulk transaction updates

### Prompts

Add reusable prompt templates for common workflows:

- Transaction categorization workflow
- Month-end budget review
- Spending analysis

## Backlog

- Streaming for large result sets
- Custom logger for server-side logging
- Tool authorization (`canAccess`) for fine-grained permissions
- UserError for cleaner client-facing errors
