# Agent Tool Design Review: Gap Analysis & Adaptation Plan

**Date:** 2026-03-10
**Spec:** Agent-Friendly Tool Design skill doc
**Status:** Draft — awaiting review

---

## Executive Summary

The ynab-mcp-deluxe server is a well-built MCP server with strong input validation (Zod), good error messages, and a thoughtful caching/sync strategy. However, it was designed as an **MCP-first tool with comprehensive upfront descriptions** — essentially the opposite of the spec's progressive disclosure philosophy. The biggest wins will come from:

1. **Progressive disclosure** — Moving verbose tool docs out of MCP tool descriptions and into on-demand help/guidance tools
2. **Dry-run support** for mutations
3. **Structured audit logging** for all mutations (JSONL journal with before-state)
4. **Input hardening** against hallucination-specific failure modes

A CLI surface is explicitly **not recommended** at this time (see rationale below).

---

## Current State vs. Spec: Gap Analysis

### What We Already Do Well

| Spec Requirement            | Current State                      | Notes                                     |
| --------------------------- | ---------------------------------- | ----------------------------------------- |
| JSON output                 | ✅ All tools return JSON           | Pretty-printed, consistent                |
| Input validation (Zod)      | ✅ Strong schema validation        | SDK-derived enums, type-safe              |
| Auth via env vars           | ✅ `YNAB_ACCESS_TOKEN`             | No browser flow needed                    |
| Budget scoping (safety)     | ✅ `YNAB_BUDGET_ID` constraint     | Single-budget lockdown                    |
| Read-only mode              | ✅ `YNAB_READ_ONLY`                | Global write block                        |
| Error messages with context | ✅ `createEnhancedErrorResponse()` | Actionable suggestions per status code    |
| Field selection             | ✅ JMESPath `query` param          | Projection, filtering, and transformation |
| Backup/snapshot capability  | ✅ Manual + auto sync-history      | Full budget state capture                 |
| Tool annotations            | ✅ `readOnlyHint`, `openWorldHint` | MCP-standard metadata                     |
| Payload logging             | ✅ Full request/response capture   | MCP tools + YNAB HTTP, session-organized  |

### Gaps (Ordered by Impact)

#### 1. Progressive Disclosure — HIGH IMPACT

**Problem:** Every tool description is 30-70 lines of documentation, examples, and field references. All 18 tools dump their full descriptions into context at MCP connection time. This is exactly the anti-pattern the spec warns against: "Do not dump large amounts of documentation, schemas, or guidance into the agent's context upfront."

**Rough token estimate:** The current tool descriptions total ~3,000-4,000 tokens. Not catastrophic, but it's dead weight when the agent only needs 2-3 tools in a given session.

**Proposed solution:**

- **Trim tool descriptions to 1-3 lines each.** Keep the one-liner purpose + the most critical parameter note (e.g., "amounts in milliunits"). Remove all examples, field lists, and detailed parameter docs.
- **Add a `help` tool** that accepts `tool_name` and optional `verbose` flag. Returns the full documentation currently in the description (concise mode) or even more detail (verbose mode).
- **Add a `guidance` tool** (equivalent to `--help=skill`) that returns strategic usage guidance: best practices, common workflows, gotchas, caching behavior, milliunit conventions, selector patterns, etc.
- **Add a `schema` tool** that returns the Zod schema for a given tool's parameters and response shape, in a structured format.

**Example — before:**

```
description: `Query transactions from YNAB with flexible filtering.

**Default behavior (no parameters):**
- Queries the default/last-used budget
- Returns ALL transactions (not filtered by status)
- Sorted by NEWEST first
- Limited to 50 results

**Parameters (all optional):**
budget - Which budget to query
  - {"name": "My Budget"} - by name (case-insensitive)
  ...
[60+ more lines of docs and examples]`
```

**Example — after:**

```
description: `Query transactions with filtering, sorting, and JMESPath projection. Amounts in milliunits. Use help("query_transactions") for full docs.`
```

#### 2. Dry-Run for Mutations — HIGH IMPACT

**Problem:** No way to preview what a mutating operation will do before executing it. The 6 write tools execute directly against the YNAB API. An agent hallucinating a wrong amount, category, or account causes real data changes that must be manually reverted.

**Proposed solution:**

- Add `dry_run: boolean` parameter to all write tools (`create_transactions`, `update_transactions`, `delete_transaction`, `update_category_budget`, `create_account`, `import_transactions`).
- When `dry_run: true`, perform all validation and selector resolution (account/category/payee name → ID), then return a structured preview of what _would_ happen without making the API call.
- Preview output includes: resolved entity names/IDs, validated amounts with currency conversion, any warnings (e.g., "payee 'Starbuks' not found — YNAB will create a new payee").

**Design consideration:** `import_transactions` is a fire-and-forget YNAB API call with no request body to preview — dry-run may not be meaningful for it. Could still return "Would trigger import for budget X, account Y" as a confirmation.

#### 3. Structured Audit Logging — MEDIUM-HIGH IMPACT

**Problem:** Mutations need a structured, queryable audit trail with before-state capture for undo scenarios.

**Update (2026-03-14):** Main now has comprehensive **payload logging** (`payload-logger.ts`, `fetch-interceptor.ts`, `tool-logging.ts`) that captures:

- All MCP tool requests/responses (via `createLoggingToolAdder` wrapper)
- All YNAB HTTP requests/responses (via global fetch interceptor)
- Organized by session, written to `~/.config/ynab-mcp-deluxe/payloads/YYYY-MM-DD/session-{id}/`
- Each payload is a separate JSON file with sequence numbering
- Headers are sanitized (auth tokens redacted)
- Configurable via `YNAB_PAYLOAD_LOGGING`, `YNAB_PAYLOAD_AUTO_PURGE`, `YNAB_PAYLOAD_RETENTION_DAYS`

**What payload logging covers that overlaps with our audit logging proposal:**

- Tool name, arguments, result, session ID, timestamp — all captured
- Success/failure tracking with duration

**What's still missing (audit-specific gaps):**

- **Before-state capture** for updates/deletes — the payload logger records what was _sent_ and _returned_, but not the entity state _before_ the mutation. For `update_transactions`, we'd need to fetch the current transaction state before applying the update.
- **Queryable audit tool** — no `audit_log` MCP tool to let the agent search recent mutations. The payload files are on disk but not exposed via the MCP interface.
- **JSONL format** — the current payload logger writes one JSON file per payload. A JSONL append-only journal would be more efficient for audit queries. However, this may not be worth the complexity since the current approach is already working.

**Revised recommendation:** Build the audit tool on top of the existing payload logger rather than creating a parallel system. Add before-state capture to the write tool wrappers. The `audit_log` tool can read from the existing payload directory structure.

#### 4. Input Hardening Against Hallucinations — MEDIUM IMPACT

**Problem:** Zod schemas validate types and shapes, but don't defend against the specific hallucination patterns the spec identifies: path traversals, embedded query params in IDs, double URL encoding, control characters.

**Current state:** The YNAB API would likely reject most malformed IDs (they're UUIDs), but we should fail fast locally with clear errors rather than forwarding garbage to the API.

**Proposed solution:**

- Add a `validateResourceId(id: string, entityType: string)` helper that:
  - Rejects IDs containing `?`, `#`, `/`, `..`, or `%`
  - Rejects control characters (below ASCII 0x20)
  - Validates UUID format (YNAB uses UUID v4 for most IDs)
  - Returns a structured error message: "Invalid {entityType} ID: contains '{char}'. Expected a UUID like 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'."
- Apply this to all selector `id` fields in the Zod schemas via `.refine()`
- Add memo/note field sanitization: reject or warn on control characters in string inputs

#### 5. Consistent Response Envelope — MEDIUM IMPACT

**Problem:** Response structure varies by tool. Read tools return raw arrays/objects. Write tools return `{ created: [...], duplicates: [...], message: "..." }`. Errors use `{ content: [{text, type}], isError: true }`. The agent has to adapt parsing per tool.

**Proposed solution:**

- Standardize on a response envelope for the tool return value (the string that goes into the MCP `content` text field):
  ```json
  {
    "data": { ... },
    "metadata": {
      "tool": "query_transactions",
      "budget_id": "...",
      "count": 15,
      "cached": true,
      "timestamp": "..."
    }
  }
  ```
- Error responses already have structure via `createEnhancedErrorResponse()` — keep that, but ensure the error body includes `expected` and `actual` fields where applicable.

**Note:** This is a breaking change for any agents that parse current response shapes. Consider a phased rollout or feature flag.

#### 6. Self-Referencing Help in Tool Descriptions — LOW-MEDIUM IMPACT

**Problem:** After trimming tool descriptions (gap #1), the agent needs a way to discover that help is available. Currently there's no meta-tool awareness.

**Proposed solution:**

- Each trimmed tool description ends with: `Use help("tool_name") for full docs and examples.`
- The server's `instructions` string (sent at connection time) includes a brief note: "Use the help, guidance, and schema tools to learn about available tools."
- The `help` tool's own description is slightly more detailed than other tools, explaining the progressive disclosure system.

#### 7. Bootstrap Skill File — LOW IMPACT (but easy)

**Problem:** CLAUDE.md contains comprehensive documentation that gets loaded into context. The spec recommends a minimal bootstrap file that redirects to dynamic help.

**Proposed solution:**

- This is mostly a documentation concern. The current CLAUDE.md serves the developer, not the agent-at-runtime. The MCP `instructions` field is the right place for agent-facing bootstrap guidance.
- Update server `instructions` to include:
  - One-sentence description
  - Pointer to `help`, `guidance`, and `schema` tools
  - Note about milliunit convention and selector pattern
- Optionally create a minimal `SKILL.md` or similar for agent plugin contexts

---

## Additional Planned Work

### CLI Surface — PLANNED

The spec strongly advocates CLI-first architecture. Our core business logic already lives in `ynab-client.ts` and `helpers.ts` (not in MCP server.ts tool handlers), so the shared-core + thin-surfaces architecture is achievable.

**Key design decisions:**

- **Disk-based caching**: The CLI will cache budget data to disk (e.g., `~/.config/ynab-mcp-deluxe/cache/`) with a configurable TTL, mirroring the MCP server's in-memory cache. This avoids burning 4+ API calls per invocation against YNAB's 200/hr rate limit.
- **`--force-sync` flag**: Skip the disk cache and do a full reload from the YNAB API.
- **JSONL output for list operations**: `query_transactions`, `get_payees`, `get_categories`, `get_accounts` emit one JSON object per line, enabling streaming/pipe composition.
- **JSON output for single-entity operations**: `get_budget_summary`, `get_payee_history` return a single JSON object.
- **Shared Zod validation**: CLI input validation reuses the same Zod schemas as MCP tools.

**Token efficiency benefit**: The Playwright case study showed 4x fewer tokens via CLI vs MCP. For YNAB, the savings come from: (a) no tool schemas loaded upfront, (b) no JSON-RPC framing overhead per call, (c) the agent can use `--help` on demand instead of receiving all docs at connection time.

**Architecture:**

```
src/
  core/             # Shared business logic (extracted from ynab-client.ts, helpers.ts)
  mcp/              # MCP server surface (server.ts, trimmed)
  cli/              # CLI surface (arg parsing, TTY detection, output formatting)
```

### Pagination — GAP (applies to both MCP and CLI)

**Problem:** Current tools return results up to `limit` (default 50, max 500) with no way to retrieve subsequent pages. If a user has 300 uncategorized transactions and requests `limit: 50`, they get the first 50 and cannot access 51-300 without workarounds (narrowing `since_date`, JMESPath hacks).

**Proposed solution:**

- Add `offset` parameter alongside `limit` to list tools (`query_transactions`, `get_payees`, `get_categories`, `get_accounts`).
- Response includes `total_count` in metadata so the agent knows how many results exist.
- CLI: pagination is natural — the agent can pipe output or request additional pages.
- MCP: the agent calls the tool again with `offset: 50` to get the next page.

**Note:** This is distinct from JSONL streaming. Pagination is about _retrieving_ chunks; JSONL is about _streaming_ them. Both are useful; pagination applies to both surfaces.

### JSONL Streaming — PLANNED (CLI surface)

JSONL is immediately useful in the CLI surface for list operations. In MCP, responses are single text content blocks so JSONL doesn't add value until MCP supports streaming.

- CLI list commands emit one JSON object per line (JSONL)
- Enables pipe composition: `ynab transactions --uncategorized | jq '.payee_name'`
- MCP continues returning JSON arrays (single response blob)

### Field Masks (Beyond JMESPath)

JMESPath already provides projection (`[*].{id: id, name: name}`). Adding a separate `--fields` parameter would be redundant. However, we should promote JMESPath more prominently in the `guidance` tool as the mechanism for context-window-friendly responses.

---

## Implementation Plan (Proposed Order)

### Phase 1: Progressive Disclosure (Highest ROI)

1. **Create help content registry** — Extract current tool descriptions into a structured map of `{ concise, verbose, examples }` per tool.
2. **Add `help` tool** — Accepts `tool_name` and `verbose` flag. Returns documentation from the registry.
3. **Add `guidance` tool** — Returns strategic guidance (milliunit conventions, selector patterns, caching behavior, JMESPath tips, common workflows, rate limit awareness).
4. **Add `schema` tool** — Returns Zod schema details for a given tool's parameters and response shape.
5. **Trim existing tool descriptions** — Replace verbose descriptions with 1-3 line summaries ending with a pointer to `help()`.
6. **Update server `instructions`** — Brief bootstrap pointing to meta-tools.

### Phase 2: Safety & Auditability

7. **Add `dry_run` parameter** to all write tools with preview output.
8. **Add before-state capture** — Extend the existing payload logging wrapper to fetch entity state before mutations (update/delete). This builds on the `tool-logging.ts` infrastructure already on main.
9. **Add `audit_log` tool** — Read recent mutations from the existing payload directory, filterable by date, action type, budget.
10. **Add input hardening** — UUID validation, control char rejection, encoding checks on ID fields.

### Phase 3: CLI Surface & Streaming

11. **Extract shared core** — Move business logic from `ynab-client.ts` and `helpers.ts` into `src/core/` so both MCP and CLI surfaces can use it.
12. **Build CLI surface** — Arg parsing, disk-based caching with TTL, `--force-sync` flag, `--help` per command.
13. **JSONL output for CLI list commands** — `query_transactions`, `get_payees`, `get_categories`, `get_accounts` emit JSONL.
14. **Add pagination (offset)** — `offset` parameter on list tools (both MCP and CLI), `total_count` in response metadata.

### Phase 4: Polish

15. **Standardize response envelope** — Consistent `{ data, metadata }` structure.
16. **Add self-referencing help pointers** — Ensure all help outputs reference other help capabilities.
17. **Create bootstrap skill file** — Minimal `SKILL.md` for agent plugin contexts.
18. **Structured error messages** — Add `expected`/`actual` fields to error responses.

---

## Open Questions

1. **Should we version the help content?** If tool behavior changes, old guidance becomes stale. The dynamic help model ensures help is always current (it's served from the same codebase), but we should think about backward compatibility.

2. **How verbose should trimmed descriptions be?** The spec says "one-liner" but our tools have genuinely important constraints (milliunits, selector format) that agents consistently need. A 2-3 line description with the most critical info may be the right balance.

3. **Before-state capture for `update_transactions`**: This requires an extra API call per update (fetching the current state). Worth the rate limit cost? Could batch-fetch with the update in a transaction-like pattern.

4. **Response envelope migration**: This is a breaking change. Should we feature-flag it, version it, or just ship it?

5. **`guidance` tool scope**: Should guidance be tool-scoped (like `--help=skill` per subcommand) or global? I'm leaning global since YNAB concepts (milliunits, selectors, caching) apply across all tools, with per-tool guidance available via `help(tool, verbose=true)`.

---

## Checklist (from the spec, applied to this project)

- [ ] Tool descriptions are concise (not a wall of text) — **GAP: Currently 30-70 lines each**
- [ ] Verbose help available on-demand — **GAP: No help tool**
- [ ] Strategic guidance available — **GAP: No guidance tool**
- [ ] Help outputs reference other help capabilities — **GAP: No self-referencing**
- [ ] Schema introspection available — **GAP: No schema tool**
- [x] JSON output for all tools — **DONE**
- [ ] JSONL for streaming — **PLANNED for CLI surface**
- [ ] CLI surface with disk caching — **PLANNED (Phase 3)**
- [ ] Pagination (offset param on list tools) — **GAP: No offset/cursor support**
- [x] Field selection (JMESPath) — **DONE**
- [x] Input validation (Zod schemas) — **DONE (but needs hallucination hardening)**
- [ ] Error messages structured with expected vs actual — **PARTIAL**
- [ ] `dry_run` for mutations — **GAP: Not implemented**
- [ ] Audit logging for mutations — **PARTIAL: Payload logging captures tool calls + HTTP traffic. Missing: before-state capture, queryable audit tool**
- [x] Auth via env vars — **DONE**
- [ ] MCP uses minimal descriptions + help/schema/guidance — **GAP: Descriptions are verbose**
- [ ] Bootstrap skill file is a redirect — **GAP: No skill file**
