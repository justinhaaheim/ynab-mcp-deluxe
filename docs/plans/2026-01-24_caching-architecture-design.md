# YNAB API Caching Architecture Design

## Problem Statement

We want to enable fast, comprehensive access to budget data for scenarios like:
- Categorizing hundreds of transactions in a session
- Looking up payee history going back years
- Analyzing categorization patterns and splits
- Surfacing distribution data to LLMs for decision-making

Without hitting YNAB's rate limits (~200 requests/hour).

## Key Constraints & Goals

1. **Avoid separate code paths** - Don't want "online mode" vs "offline mode" with different implementations
2. **Avoid premature optimization** - Maybe live API is fine; don't over-engineer
3. **Keep it simple** - Easy to reason about, maintain, and debug
4. **Fast historical lookups** - The main value-add is quick access to comprehensive data

## Current Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│ server.ts   │────▶│ ynab-client  │────▶│ YNAB API │
│ (MCP tools) │     │ (wrapper)    │     │          │
└─────────────┘     └──────────────┘     └──────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ BudgetCache  │  (accounts, categories, payees)
                    │ (in-memory)  │  (NO transactions currently)
                    └──────────────┘
```

The key insight: **ynab-client.ts is already a caching layer** - it just doesn't cache transactions yet.

---

## Design Options

### Option A: Transparent Cache Extension (Recommended)

**Idea:** Extend the existing ynab-client caching to include transactions. The interface doesn't change; caching decisions are internal.

```
┌─────────────┐     ┌──────────────────────────────────┐     ┌──────────┐
│ server.ts   │────▶│ ynab-client                      │────▶│ YNAB API │
│ (MCP tools) │     │                                  │     │          │
│             │     │  ┌────────────────────────────┐  │     └──────────┘
│ (unchanged) │     │  │ BudgetCache                │  │
└─────────────┘     │  │  - accounts, categories    │  │
                    │  │  - payees                  │  │
                    │  │  - transactions (NEW)      │  │
                    │  │  - server_knowledge (NEW)  │  │
                    │  └────────────────────────────┘  │
                    └──────────────────────────────────┘
```

**How it works:**
- First transaction query loads ALL transactions and caches them
- Subsequent queries filter from cache (instant)
- Writes go to API immediately AND update local cache
- Optional delta sync after writes using `server_knowledge`

**Pros:**
- No code changes to server.ts or tool definitions
- No "modes" - just smarter caching
- Cache is always consistent with server (write-through)
- Easy to understand: "it's just caching"

**Cons:**
- Initial load can be slow for large budgets
- Memory usage for huge transaction histories

---

### Option B: Explicit Snapshot Mode

**Idea:** Add a `load_budget_snapshot` tool that downloads everything, then all reads come from snapshot.

```typescript
// New tool
load_budget_snapshot({ budget, include_transactions: true })

// Existing tools work against snapshot
query_transactions({ ... })  // reads from snapshot
get_payee_history({ ... })   // reads from snapshot
```

**Pros:**
- Explicit control over when to load
- Clear mental model: "I'm working with a snapshot"

**Cons:**
- Adds complexity - when should LLM load snapshot?
- Snapshot can become stale
- Still need to handle "non-snapshot" mode

---

### Option C: Write Queue with Explicit Commit

**Idea:** Queue writes locally, commit in batches.

```typescript
begin_batch_mode()
update_transactions(...)  // queued locally
update_transactions(...)  // queued locally
commit_batch()            // sends all to server
```

**Pros:**
- Minimal API calls
- Can work across conversation boundaries (persist queue?)

**Cons:**
- Complexity: What if commit fails partially?
- Stale reads: Should queued changes affect queries?
- User confusion: "Did my changes save?"
- Cross-conversation state is tricky

---

## Recommendation: Option A with Lazy Loading

**Start simple:** Extend the existing cache to include transactions with lazy loading.

### Implementation Details

```typescript
interface BudgetCache {
  // Existing
  accounts: Account[]
  categories: Category[]
  payees: Payee[]
  // ... existing maps ...

  // NEW
  transactions: TransactionDetail[] | null  // null = not loaded yet
  transactionsByPayee: Map<string, TransactionDetail[]>
  transactionsByCategory: Map<string, TransactionDetail[]>
  serverKnowledge: number | null  // for delta sync
}
```

### Behavior

1. **First `query_transactions` call:**
   - Fetches ALL transactions from API (one call)
   - Builds lookup maps (by payee, by category, etc.)
   - Returns filtered results

2. **Subsequent `query_transactions` calls:**
   - Filters from cache (instant)
   - No API call

3. **`get_payee_history` calls:**
   - Uses `transactionsByPayee` map (instant after first load)

4. **Write operations (`update_transactions`, etc.):**
   - Send to API immediately
   - Update local cache with the response
   - Optionally: delta sync to catch any server-side changes

5. **Optional: `refresh_budget` tool:**
   - Uses delta sync if available
   - Or full refresh if needed
   - Explicit user/LLM control over when to sync

### Why Not Write Queuing?

I think write queuing adds complexity without clear benefit because:

1. **We already have batch updates** - `update_transactions` accepts up to 100 transactions
2. **LLMs can batch naturally** - "Here are 15 transactions to categorize, update them all"
3. **Immediate feedback is valuable** - User/LLM knows changes are saved
4. **Cross-conversation queues are complex** - Persistence, conflicts, recovery

If we find we need write queuing later, we can add it. But start without.

---

## Questions to Answer

### Q: What about delta sync reliability?

**Approach:** Test it. The YNAB API docs say delta sync works for:
- `/budgets/{id}`
- `/budgets/{id}/transactions`
- `/budgets/{id}/accounts`
- etc.

We should test whether fetching budget, updating transactions, and delta-syncing returns just the changes. If it works well, use it. If not, fall back to full refresh after writes.

### Q: What if data changes on server while we're working?

**Approach:** For most use cases (solo categorization session), this is fine. Data doesn't change that often. Options:
1. Trust the cache for the session duration
2. Add a `refresh_budget` tool for explicit refresh
3. Auto-refresh after N minutes (probably overkill)

### Q: Memory concerns for large budgets?

**Approach:**
- Lazy load: only load transactions when first needed
- For most budgets, even 10k transactions is ~10-20MB in memory - fine
- If we hit limits, consider SQLite later (don't pre-optimize)

### Q: How does this affect existing tools?

**Answer:** It doesn't! The interface stays the same. `query_transactions` still takes the same parameters. The caching is an internal implementation detail of ynab-client.

---

## Proposed Changes

### Phase 1: Transaction Caching (Minimal)

1. Add `transactions` to `BudgetCache`
2. Modify `getTransactions()` to check cache first
3. Build lookup maps on first load
4. Update cache after write operations

**Estimated effort:** Small-medium

### Phase 2: Payee History Optimization

1. Use `transactionsByPayee` map for `get_payee_history`
2. Pre-compute common patterns (most frequent category per payee)

**Estimated effort:** Small

### Phase 3: Delta Sync (Optional)

1. Store `serverKnowledge` per budget
2. Use it for incremental refreshes
3. Test reliability

**Estimated effort:** Small, but needs testing

### Phase 4: Explicit Refresh Tool (Optional)

1. Add `refresh_budget` tool
2. LLM can call when they suspect data might be stale

**Estimated effort:** Tiny

---

## Decision

**Proceed with Option A (Transparent Cache Extension)** because:
- Minimal code changes
- No new "modes" to maintain
- Leverages existing architecture
- Can be enhanced incrementally
- Avoids premature optimization while enabling fast lookups

The key principle: **The cache is an implementation detail of ynab-client, not a feature the tools need to know about.**
