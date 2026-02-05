# Server Payload Logging Feature

## Goal

Create comprehensive logging of all MCP tool requests/responses and YNAB API calls to enable debugging and auditing during alpha development.

## Key Findings from Exploration

1. **FastMCP doesn't have built-in middleware** - No hooks for intercepting requests
2. **Existing Pino logger** writes to `~/.config/ynab-mcp-deluxe/logs/` with daily rotation
3. **Backup pattern** demonstrates file writing to config directory
4. **YNAB SDK** accepts custom `fetchApi` option - we can intercept HTTP calls!

## Design Decision

**Recommended Approach: Dual-layer logging**

1. **MCP Tool Layer**: Wrapper function around tool execution
2. **YNAB HTTP Layer**: Custom fetch wrapper passed to YNAB SDK

This captures:

- What the AI client sent (tool name, arguments)
- What we returned (success/error, response data)
- What we sent to YNAB API (HTTP requests)
- What YNAB returned (HTTP responses)

## File Structure

```
~/.config/ynab-mcp-deluxe/
├── logs/                    # Existing Pino logs (structured JSON)
│   └── server.2026-02-02.1.log
├── payloads/                # NEW: Full request/response payloads
│   └── 2026-02-02/          # Organized by date
│       ├── 001_14-32-15_query_transactions_req.json
│       ├── 001_14-32-16_ynab_get-budget_req.json
│       ├── 001_14-32-17_ynab_get-budget_res.json
│       └── 001_14-32-18_query_transactions_res.json
└── backups/                 # Existing backups
```

### Filename Format

`{sequence}_{time}_{layer}_{operation}_{direction}.json`

- **sequence**: 3-digit number per session (001, 002, ...)
- **time**: HH-mm-ss
- **layer**: `mcp` or `ynab`
- **operation**: tool name or API endpoint
- **direction**: `req` or `res`

## Payload Structure

### MCP Request

```json
{
  "timestamp": "2026-02-02T14:32:15.123Z",
  "requestId": "abc-123",
  "tool": "query_transactions",
  "arguments": {
    /* full args */
  }
}
```

### MCP Response

```json
{
  "timestamp": "2026-02-02T14:32:18.456Z",
  "requestId": "abc-123",
  "tool": "query_transactions",
  "durationMs": 3333,
  "success": true,
  "response": {
    /* full response or error */
  }
}
```

### YNAB HTTP Request

```json
{
  "timestamp": "2026-02-02T14:32:16.000Z",
  "method": "GET",
  "url": "https://api.ynab.com/v1/budgets/xxx",
  "headers": {
    /* sanitized - no auth token */
  }
}
```

### YNAB HTTP Response

```json
{
  "timestamp": "2026-02-02T14:32:17.500Z",
  "method": "GET",
  "url": "https://api.ynab.com/v1/budgets/xxx",
  "status": 200,
  "durationMs": 1500,
  "headers": {
    /* response headers */
  },
  "body": {
    /* full JSON body */
  }
}
```

## Implementation Plan

### Phase 1: Create Payload Logger Module

- [x] Create `src/payload-logger.ts`
- [x] Implement file writing with date-based directories
- [x] Add sequence counter for ordering
- [x] Add environment variable toggle: `YNAB_PAYLOAD_LOGGING` (default: `true`)

### Phase 2: MCP Tool Wrapper

- [x] Create `wrapToolWithLogging()` higher-order function in `src/tool-logging.ts`
- [x] Apply to all tools in server.ts via `createLoggingToolAdder()`
- [x] Log request args and response/error

### Phase 3: YNAB HTTP Interceptor

- [x] Create custom fetch wrapper in `src/fetch-interceptor.ts`
- [x] Install globally via `installFetchInterceptor()` at server startup
- [x] Log sanitized requests (no auth token in logs)
- [x] Log full responses

### Phase 4: Update CLAUDE.md

- [x] Document new env vars
- [x] Document payload file locations in Architecture section

## Environment Variables

| Variable               | Default                              | Description                    |
| ---------------------- | ------------------------------------ | ------------------------------ |
| `YNAB_PAYLOAD_LOGGING` | `true`                               | Enable/disable payload logging |
| `YNAB_PAYLOAD_DIR`     | `~/.config/ynab-mcp-deluxe/payloads` | Override payload directory     |

## Questions / Decisions

- [x] **Folder name**: Using `payloads/` as suggested
- [x] **Default on**: Yes, default to ON during alpha
- [x] **Organization**: Date-based subdirectories + session subdirectories
- [x] **Retention**: Auto-purge code written for 30 days, but disabled by default (`YNAB_PAYLOAD_AUTO_PURGE=false`)

## Progress

- [x] Design approved by user
- [x] Payload logger module created (`src/payload-logger.ts`)
- [x] MCP tool wrapper implemented (`src/tool-logging.ts`)
- [x] YNAB HTTP interceptor implemented (`src/fetch-interceptor.ts`)
- [x] Documentation updated (CLAUDE.md)
- [x] All signal checks passing

## Phase 5: Bug Fixes and Improvements (2026-02-05)

Issues identified during code review - all completed:

### ynab-mcp-deluxe-mlc (P2): Circuit breaker for ensureSessionDir ✅

- [x] Add failure counter and disable logging after N failures (MAX_DIR_FAILURES = 3)
- [x] Prevents repeated mkdir attempts on permission errors
- [x] Circuit breaker resets on session change

### ynab-mcp-deluxe-1gv (P3): Type safety in createLoggingToolAdder ✅

- [x] Investigated proper typing - FastMCP uses complex generics (StandardSchemaV1, auth types)
- [x] Added detailed explanatory comment explaining why suppression is safe

### ynab-mcp-deluxe-04v (P3): Error details in fetch-interceptor ✅

- [x] Include error message when JSON/text parsing fails
- [x] Returns `{_parseError, jsonError, textError}` object for debugging

### ynab-mcp-deluxe-74q (P3): Extend sequence counter ✅

- [x] Changed from 3-digit (999 max) to 6-digit (999,999 max)
- [x] Added documentation comment explaining the limit

### ynab-mcp-deluxe-5yy (P1): Add tests ✅

- [x] Tests for payload-logger.ts (20 tests)
- [x] Tests for tool-logging.ts (15 tests)
- [x] Tests for fetch-interceptor.ts (8 tests)
- Total: 43 new tests, all passing
