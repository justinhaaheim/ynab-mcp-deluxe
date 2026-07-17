# Competitor YNAB Project Analysis

**Date**: 2026-01-31
**Purpose**: Extract learnings from other YNAB MCP/CLI projects to strengthen ynab-mcp-deluxe

## Projects Analyzed

| Project                                                                   | Type       | Key Focus                                | Tools/Commands |
| ------------------------------------------------------------------------- | ---------- | ---------------------------------------- | -------------- |
| [stephendolan/ynab-cli](https://github.com/stephendolan/ynab-cli)         | CLI + MCP  | Developer UX, security                   | ~20            |
| [dizzlkheinz/ynab-mcpb](https://github.com/dizzlkheinz/ynab-mcpb)         | MCP Server | Receipt itemization, bank reconciliation | 29             |
| [issmirnov/ynab-mcp-server](https://github.com/issmirnov/ynab-mcp-server) | MCP Server | Analytics, workflow automation           | 18             |
| [AbdallahAHO/ynab-tui](https://github.com/AbdallahAHO/ynab-tui)           | TUI + CLI  | AI categorization, payee management      | N/A            |

---

## Summary: What Each Project Does Better

### ynab-cli (stephendolan)

| Feature                | Description                                                           | Priority |
| ---------------------- | --------------------------------------------------------------------- | -------- |
| **OS Keychain Auth**   | Stores token securely via `@napi-rs/keyring` instead of env vars      | High     |
| **Default Budget**     | Persist default budget in config, don't require `--budget` every time | Medium   |
| **Raw API Access**     | `ynab api GET/POST <path>` escape hatch for any endpoint              | Medium   |
| **Field Filtering**    | `--fields id,date,amount` to limit output fields                      | Medium   |
| **Error Sanitization** | Redacts Bearer tokens from error messages                             | High     |
| **Dual Mode**          | Single codebase supports both CLI and MCP server                      | Low      |

### ynab-mcpb (dizzlkheinz)

| Feature                   | Description                                                                                    | Priority |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| **Receipt Itemization**   | Split transactions from receipts with tax allocation                                           | High     |
| **Bank Reconciliation**   | CSV import, fuzzy matching, bank format presets (TD, RBC, Scotiabank, Wealthsimple, Tangerine) | High     |
| **Tool Annotations**      | MCP hints: `readOnlyHint`, `destructiveHint`, `idempotentHint`                                 | Medium   |
| **Tool Registry Pattern** | Centralized registration with dependency injection                                             | Medium   |
| **LRU Cache**             | Stale-while-revalidate pattern, per-TTL constants                                              | Low      |
| **Rate Limiter**          | Token bucket algorithm for YNAB API compliance                                                 | Medium   |

### ynab-mcp-server (issmirnov)

| Feature                       | Description                                                   | Priority |
| ----------------------------- | ------------------------------------------------------------- | -------- |
| **Spending Pattern Analysis** | Per-category trends, anomaly detection, insights              | High     |
| **Cash Flow Forecast**        | Project 1-12 months with confidence levels                    | High     |
| **Goal Progress Reports**     | TB/TBD/MF goal tracking with status                           | High     |
| **Category Performance**      | Budget utilization, overspend frequency, ratings              | Medium   |
| **Budget from History**       | Suggest budgets based on historical spending                  | Medium   |
| **Handle Overspending**       | Auto-resolve by moving funds intelligently                    | High     |
| **Auto-Distribute Funds**     | Allocate "Ready to Assign" based on goals                     | Medium   |
| **Bulk Operations**           | Bulk approve, bulk move funds                                 | Medium   |
| **Retry Logic**               | Exponential backoff, anti-bot detection, rate limit awareness | High     |
| **Modular Tools**             | One file per tool (18 files) vs our monolithic server.ts      | Medium   |

### ynab-tui (AbdallahAHO)

| Feature                | Description                                          | Priority |
| ---------------------- | ---------------------------------------------------- | -------- |
| **AI Categorization**  | Confidence scores, alternatives, historical learning | High     |
| **Transfer Detection** | Auto-match same amount, opposite signs, 3-day window | High     |
| **Payee Management**   | Name cleanup, auto-tagging, duplicate detection      | Medium   |
| **YOLO Mode**          | Batch auto-categorize above confidence threshold     | Medium   |
| **Memo Generation**    | AI-powered memo suggestions                          | Low      |
| **CLI Automation**     | Headless mode for cron jobs                          | Medium   |

---

## Our Strengths (ynab-mcp-deluxe)

| Feature                    | Description                                                         | vs Competition |
| -------------------------- | ------------------------------------------------------------------- | -------------- |
| **Delta Sync**             | Efficient incremental updates with `server_knowledge`               | Unique         |
| **Drift Detection**        | Validates merge logic for data consistency                          | Unique         |
| **Auto-Backup**            | 24-hour throttled backups to `~/.config/ynab-mcp-deluxe/backups/`   | Unique         |
| **Transaction Enrichment** | Adds resolved names alongside IDs (`account_name`, `category_name`) | Better         |
| **Per-Budget Caching**     | O(1) lookup maps, selective invalidation after writes               | Better         |
| **JMESPath Filtering**     | Powerful query language for complex filters                         | Better         |
| **Flexible Selectors**     | Accept ID or name for accounts, categories, payees                  | Better         |
| **Type-Safe Enums**        | Derive from YNAB SDK, not hardcoded strings                         | Better         |

---

## Top Priority Improvements

### Tier 1: Essential (High User Value)

1. **Spending Analytics Suite**

   - `analyze_spending_patterns` - trends, anomalies, insights
   - `cash_flow_forecast` - project future months
   - `goal_progress_report` - track goal completion
   - Source: ynab-mcp-server

2. **Bank Reconciliation**

   - CSV import with bank format presets
   - Fuzzy transaction matching
   - Discrepancy detection and resolution
   - Source: ynab-mcpb

3. **AI Transaction Categorization** (requires external AI)

   - Confidence-scored suggestions
   - Historical pattern learning
   - Batch auto-categorize (YOLO mode)
   - Source: ynab-tui

4. **Transfer Detection**
   - Auto-match same amount, opposite signs, 3-day window
   - Return detected pairs in transaction queries
   - Source: ynab-tui

### Tier 2: Important (Security/UX)

5. **Error Sanitization**

   - Redact Bearer tokens from error messages
   - Source: ynab-cli

6. **Retry Logic**

   - Exponential backoff (1s → 2s → 4s)
   - Anti-bot detection
   - Rate limit awareness
   - Source: ynab-mcp-server

7. **Handle Overspending Tool**

   - Auto-resolve by moving funds from available categories
   - Smart source selection
   - Source: ynab-mcp-server

8. **Receipt Itemization**
   - Split transactions from receipts
   - Proportional tax allocation
   - Source: ynab-mcpb

### Tier 3: Nice-to-Have

9. **Tool Annotations**

   - Add MCP hints for safety metadata
   - Source: ynab-mcpb

10. **Raw API Access**

    - Escape hatch for any YNAB endpoint
    - Source: ynab-cli

11. **OS Keychain Auth** (optional)

    - More secure than env vars
    - Source: ynab-cli

12. **Modular Tool Architecture**
    - Split server.ts into tool files
    - Source: ynab-mcp-server

---

## Implementation Notes

### Analytics Tools Architecture

From ynab-mcp-server:

```typescript
// Each tool is a separate file with class pattern
class AnalyzeSpendingPatternsTool {
  getToolDefinition(): Tool { ... }
  async execute(input: Input) { ... }
}
```

Key metrics to calculate:

- **Trend**: Compare 3-month rolling averages (increasing/decreasing/stable/volatile)
- **Anomaly**: Spending > 2x monthly average
- **Confidence**: Based on variance (low variance = high confidence)

### Bank Reconciliation Algorithm

From ynab-mcpb:

```
1. Parse CSV → BankTransaction[] (all in milliunits)
2. Fetch YNAB transactions → NormalizedYNABTransaction[]
3. Match using weighted scoring:
   - Amount (50%): Exact match = 100, tolerance = 80-95
   - Payee (35%): Fuzzy match via fuzzball library
   - Date (15%): Same day = 100, decay over 7 days
4. Confidence thresholds: high (85+), medium (60-84), low (40-59)
5. Execution modes: analysis_only, guided_resolution, auto_resolve
```

### Transfer Detection Algorithm

From ynab-tui:

```typescript
// 1. Group uncategorized transactions by absolute amount
// 2. For each group with 2+ transactions:
//    - Separate outflows (negative) from inflows (positive)
//    - Match pairs by date proximity (3-day window)
//    - Skip same-account matches
// 3. Confidence: 1.0 (same day) → 0.7 (3 days) → 0.0 (beyond)
```

### AI Categorization Architecture

From ynab-tui:

```typescript
// Context building:
// - User context (location, language)
// - Historical patterns from past categorizations
// - Payee rules and tags
// - Account descriptions

// Output:
// - Primary category with confidence (0-1)
// - 3 alternatives with reasoning
// - Optional memo suggestion
// - Cache key: MD5(payee + direction + model)
```

---

## Beads Issues Created

- `ynab-yxq`: Epic - Analyze competitor projects
- `ynab-bmh`: Analyze stephendolan/ynab-cli
- `ynab-55u`: Analyze dizzlkheinz/ynab-mcpb
- `ynab-8p9`: Analyze issmirnov/ynab-mcp-server
- `ynab-0mj`: Analyze AbdallahAHO/ynab-tui

---

## Next Steps

1. Create beads issues for top priority improvements
2. Start with analytics suite (highest value, well-documented)
3. Then bank reconciliation (complex but high impact)
4. Then transfer detection (simpler, standalone)
5. AI categorization last (requires external AI setup)
