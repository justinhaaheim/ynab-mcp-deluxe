# ROADMAP

Project roadmap for ynab-mcp-deluxe.

## Current State

A working MCP server with 15 tools for YNAB budget management:

- Budget queries (transactions, categories, accounts, payees, months)
- Transaction management (create, update, delete, import)
- Budget allocation (update category budgets)
- Backup (manual and automatic on first tool call)

## Important - Strategic Design

1. **Review workflow design document** - `docs/plans/2026-01-19_ynab-workflows-mcp-design.md` contains comprehensive analysis of YNAB workflows (reconciliation, categorization, budget catch-up) and proposes workflow-oriented tools. Work backward from real user workflows to ensure our tools are maximally helpful for day-to-day and week-to-week YNAB usage.

2. **Provide YNAB context to LLMs** - The LLM using this server needs to understand YNAB deeply: the Four Rules, how categories/budgeting works, common patterns, and anti-patterns to avoid. Options to explore:
   - A `get_ynab_guide` tool that returns educational context on demand
   - An MCP Resource that exposes YNAB methodology documentation
   - An MCP Prompt template for "YNAB assistant" persona
   - Including it in the server description (may be too verbose)

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

### Smarter Caching with Delta Sync

Current caching: session-based, invalidated on write operations or via `force_refresh` parameter.

Future direction: Download the **entire budget** on first access (single API call to `/budgets/{id}`), then use YNAB's delta sync (`last_knowledge_of_server` parameter) for efficient incremental updates when cache is invalidated or TTL expires. Benefits:

- Fewer API calls (one bulk fetch vs multiple endpoint calls)
- Efficient updates (only changed data returned)
- Better rate limit management (200 req/hour limit)

The YNAB API returns `server_knowledge` with responses - store this and pass it back to get only changes since that point.

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

- **Query parameter improvements** - Add dedicated parameters for common filters (approved, cleared, flag_color, amount range, field projection) to reduce reliance on JMESPath. See `docs/plans/2026-01-24_query-parameters-vs-jmespath.md`
- Streaming for large result sets
- Custom logger for server-side logging
- Tool authorization (`canAccess`) for fine-grained permissions
- UserError for cleaner client-facing errors
