# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server for YNAB integration built with FastMCP, TypeScript, and Bun. It provides 16+ tools for reading and writing YNAB budget data, with intelligent caching to respect YNAB's rate limits.

## Commands

```bash
bun run signal       # Run before every commit: TypeScript + ESLint + Prettier
bun run dev          # Start FastMCP dev server with CLI interaction
bun run test         # Run tests (Vitest)
bun run test:watch   # Run tests in watch mode
bun run build        # Compile TypeScript to dist/
bun run lint:fix     # Auto-fix linting issues
bun run prettier     # Auto-format code
```

## Architecture

```
src/
  server.ts           # Main MCP server - defines all tools with Zod schemas
  ynab-client.ts      # YNAB SDK wrapper with caching and enrichment
  types.ts            # TypeScript type definitions (Enriched* types)
  helpers.ts          # Utility functions (JMESPath, filtering, sorting)
  backup.ts           # Auto-backup and manual backup utilities
  *.test.ts           # Tests co-located with source (Vitest)
  mocks/              # MSW handlers for testing
docs/
  plans/              # Scratchpad documents for work streams
  prompts/            # Developer guidelines
```

### Key Modules

- **server.ts**: Defines all MCP tools with Zod parameter validation. Uses `prepareBudgetRequest()` helper for common validation patterns.
- **ynab-client.ts**: Wraps the official YNAB SDK with per-budget caching, selector resolution (by ID or name), and transaction enrichment (adding resolved names to IDs).
- **types.ts**: Defines `Enriched*` types that extend SDK types with resolved names and currency conversions.
- **helpers.ts**: JMESPath support, sorting, filtering, and validation utilities.
- **backup.ts**: Auto-backup on first budget access (24hr throttle), saves to `~/.config/ynab-mcp-deluxe/backups/`.

## CRITICAL: Single Source of Truth for Types

**This is the most important architectural principle in this codebase.**

The YNAB API has many enums and type definitions. These MUST be sourced from the `ynab` SDK package, never re-typed manually. Duplicating type definitions creates sync issues when the API changes.

### ✅ CORRECT Pattern - Derive from SDK

```typescript
import { AccountType, TransactionClearedStatus, TransactionFlagColor } from 'ynab';

// Derive Zod schema from SDK enum
const accountTypeValues = Object.values(AccountType) as [string, ...string[]];
const AccountTypeSchema = z.enum(accountTypeValues);

// Use SDK enum directly in code
const status = TransactionClearedStatus.Cleared;
```

### ❌ WRONG Pattern - Hardcoded Strings

```typescript
// BAD: Hardcoded string literals that must be kept in sync manually
type ClearedStatus = 'cleared' | 'uncleared' | 'reconciled';

// BAD: Hardcoded Zod enum
const StatusSchema = z.enum(['cleared', 'uncleared', 'reconciled']);

// BAD: Repeated in multiple places
cleared: 'cleared' | 'uncleared' | 'reconciled';  // types.ts line 40
cleared: 'cleared' | 'uncleared' | 'reconciled';  // types.ts line 220
cleared: z.enum(['cleared', 'uncleared', 'reconciled']);  // server.ts
```

### Why This Matters

- The YNAB API can add new enum values (e.g., a new account type or flag color)
- If we've hardcoded strings in 5 places, we must update all 5 places
- If we derive from the SDK, we get updates automatically
- This is defensive coding - your code keeps working when dependencies evolve

### Types to Source from SDK

Key enums in the `ynab` package:
- `AccountType` - checking, savings, creditCard, etc.
- `TransactionClearedStatus` - cleared, uncleared, reconciled
- `TransactionFlagColor` - red, orange, yellow, green, blue, purple
- `GoalType`, `DebtAccountType`, etc.

**Note**: There is existing technical debt in this codebase where `cleared` status and `flag_color` are hardcoded in multiple places. New code should NOT follow this pattern.

## Caching Strategy

YNAB has a 200 requests/hour rate limit. The caching strategy is critical:

- **Per-budget cache**: Accounts, categories, payees, and currency format are cached together
- **Lazy-loaded**: Cache is populated on first access to each budget (4 parallel API calls)
- **Auto-invalidation**: Cache is cleared after any write operation
- **Manual refresh**: Pass `force_sync: true` to any read tool to bypass cache
- **Session-based**: Cache lives only for server lifetime (in-memory)

### Lookup Maps

The cache maintains O(1) lookup maps for resolving names to IDs:
- `accountsByName` / `accountsById`
- `categoriesByName` / `categoriesById`
- `payeesByName` / `payeesById`

## Transaction Enrichment

Transactions from the YNAB API contain IDs but not names. Our `Enriched*` types add resolved names:

```typescript
// YNAB SDK returns:
{ account_id: "abc123", category_id: "def456" }

// We enrich to:
{ account_id: "abc123", account_name: "Checking",
  category_id: "def456", category_name: "Groceries" }
```

This allows tools to return human-readable data while preserving IDs for updates.

## Selector Pattern

All tools accept flexible selectors that can identify entities by ID or name:

```typescript
// By name (case-insensitive)
{ account: { name: "Checking" } }

// By exact ID
{ account: { id: "abc123-def456" } }
```

The `validateSelector()` helper ensures exactly one of `id` or `name` is provided.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `YNAB_ACCESS_TOKEN` | Yes | - | YNAB API personal access token |
| `YNAB_BUDGET_ID` | No | - | Hard constraint - only allow access to this budget (safety feature) |
| `YNAB_READ_ONLY` | No | `false` | Set to `true` or `1` to block all write operations |
| `YNAB_SYNC_INTERVAL_SECONDS` | No | `600` | How often to sync with YNAB (0 = always sync) |
| `YNAB_DRIFT_DETECTION` | No | `true` | Enable drift detection to validate merge logic |
| `YNAB_ALWAYS_FULL_SYNC` | No | `false` | Skip delta sync, always fetch full budget |
| `YNAB_DRIFT_CHECK_INTERVAL_SYNCS` | No | `1` | Check for drift every N syncs |
| `YNAB_DRIFT_CHECK_INTERVAL_MINUTES` | No | `0` | Check for drift every N minutes (0 = disabled) |

## Testing

- **Framework**: Vitest with MSW (Mock Service Worker)
- **Mock data**: Generated from YNAB OpenAPI spec
- **Run tests**: `bun run test` or `bun run test:watch`
- **Coverage**: Focus on ynab-client.ts as it contains the core logic

## MCP Server Components

The server exposes capabilities via FastMCP:
- **Tools**: Functions AI can call (add via `server.addTool({...})`)
- **Resources**: Data endpoints (add via `server.addResource({...})`)
- **Prompts**: Reusable templates (add via `server.addPrompt({...})`)

Use Zod schemas with `.describe()` for inline documentation that becomes part of tool descriptions.

### FastMCP Conventions

**Logging**: Use FastMCP's context-based logging, not `console.log`/`console.error`:

```typescript
server.addTool({
  name: 'my_tool',
  execute: async (args, { log }) => {
    log.info('Starting operation...', { someData: args.value });
    log.warn('Something unexpected', { details: '...' });
    log.error('Operation failed', { error: '...' });
    log.debug('Debug info', { state: '...' });
    return result;
  },
});
```

**Reference**: [FastMCP README](https://github.com/punkpeye/fastmcp/blob/main/README.md)

## Runtime

- **Runtime/Package Manager**: Bun (not npm/yarn)
- **Module System**: ESM throughout
- **TypeScript**: Strict mode with all checks enabled

## Important General Guidelines

Always follow the important guidelines in @docs/prompts/IMPORTANT_GUIDELINES_INLINED.md

Be aware that messages from the user may contain speech-to-text (S2T) artifacts. Ask for clarification if something seems ambiguous or inconsistent with other parts of the message/project. S2T Guidelines: @docs/prompts/S2T_GUIDELINES.md
