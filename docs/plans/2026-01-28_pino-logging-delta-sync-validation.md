# Pino Logging + Delta Sync Validation

## Goal

Add pino logging to the MCP server so we can observe server behavior when Claude Code is the client. This enables manual validation of delta sync against the real YNAB API.

## Related Issue

- ynab-mcp-deluxe-b3u: Validate delta sync with real YNAB API

## Implementation Plan

### Phase 1: Add Pino Logging

- [x] Add pino, pino-roll, pino-pretty dependencies
- [x] Create `src/logger.ts` module
  - Configured pino with pino-roll transport
  - Writes to `~/.config/ynab-mcp-deluxe/logs/server.*.log`
  - Implements FastMCP's Logger interface
  - Supports `LOG_LEVEL` env var (default: debug)
  - Date-based log rotation with 7-day retention
- [x] Update `src/server.ts` to use custom logger
- [x] Updated fastmcp to v3.30.1 (from v1.27.3)
- [x] Add `bun run logs` script to tail log file with pino-pretty
- [x] Add `bun run logs:raw` for raw JSON output
- [x] Add `bun run logs:dir` to list log files

### Phase 2: Delta Sync Validation

Once logging is in place:

- [ ] Enable drift detection (`YNAB_DRIFT_DETECTION=true`)
- [ ] Make changes in YNAB (create/edit/delete transactions)
- [ ] Observe delta sync behavior in logs
- [ ] Check sync history files for actual API responses
- [ ] Document findings

## Key Questions to Validate

1. Does `GET /budgets/{id}?last_knowledge_of_server=X` return only changed entities?
2. When entities are deleted, does the API return them with `deleted: true`?
3. Does our merge logic produce the same result as a full re-fetch?

## New Logging Added

The following debug/info logging was added to `ynab-client.ts`:

1. **Sync decision logging** - Logs why sync is happening:

   - `forceSync: full/delta requested`
   - `no local budget exists (initial sync)`
   - `YNAB_ALWAYS_FULL_SYNC enabled`
   - `needsSync flag set (write operation occurred)`
   - `sync interval passed (Xs elapsed, interval: Xs)`
   - `local budget is fresh (Xs until next sync)`

2. **Delta response analysis** - Logs what's in the delta:

   - Count of items per entity type
   - Count of deleted items (for validating delete handling)
   - Sample IDs for debugging
   - Whether server knowledge changed

3. **Transaction-specific logging** - When delta contains transactions:
   - Count, deleted count, and sample IDs

## Delta Sync Validation Results (2026-01-28)

**DRIFT DETECTED** - Our merge logic has a bug!

### What We Found

1. **Delta sync WORKS** - API returns only changed entities when `last_knowledge_of_server` is passed
2. **serverKnowledge increments** - Went from 64 → 66 after changes
3. **Multiple entity types affected** - Delta included accounts, categories, months, transactions

### The Bug

`mergeMonthArray()` replaces entire month objects instead of merging nested `categories` array.

When delta returns a month, it includes the full categories for that month. Our code does:

```typescript
byMonth.set(month.month, month); // WRONG: replaces entire month
```

But the existing month had ALL categories, and the delta month only has CHANGED categories. So we lose all the unchanged categories.

**Drift detection caught this:**

- 526 differences (83 months, 443 transactions)
- All differences are `kind: "N"` - items exist in full fetch but not in merged

### Filed Issues

- **ynab-mcp-deluxe-sa2** (P1): Fix month merge bug
- **ynab-mcp-deluxe-vma** (P2): Document API behaviors (blocked by sa2)

## Progress Log

- 2026-01-28: Started work, adding pino logging infrastructure
- 2026-01-28: Added enhanced sync logging (decision reasons, delta analysis)
- 2026-01-28: Real API validation revealed month merge bug - drift detection working!
