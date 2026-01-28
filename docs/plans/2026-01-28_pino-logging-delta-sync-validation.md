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

## Progress Log

- 2026-01-28: Started work, adding pino logging infrastructure
