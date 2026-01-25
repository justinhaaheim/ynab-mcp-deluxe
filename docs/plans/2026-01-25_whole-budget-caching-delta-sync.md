# Local Budget with Delta Sync

## Mental Model

This is **not a cache**. It's a **local replica** of the user's YNAB budget that we keep in sync with the server.

Think of it like Apple Photos or any local-first app:

- You have a local copy of your data
- Periodically, you sync with the server to get the latest changes
- The local copy is what you work with day-to-day

```
┌─────────────────────┐         ┌─────────────────────┐
│    YNAB Server      │         │    MCP Server       │
│   (Source of Truth) │◄──Sync──│   (Local Budget)    │
└─────────────────────┘         └─────────────────────┘
                                         │
                                         ▼
                                ┌─────────────────────┐
                                │    MCP Client       │
                                │   (LLM / Claude)    │
                                └─────────────────────┘
```

Key mental shifts from "cache" thinking:

| Cache Thinking               | Local Replica Thinking               |
| ---------------------------- | ------------------------------------ |
| "Is this data stale?"        | "When did I last sync?"              |
| "Cache miss - need to fetch" | "First access - need initial sync"   |
| "Invalidate the cache"       | "Mark as needing sync"               |
| "Force refresh"              | "Force sync"                         |
| Temporary, disposable        | Persistent, authoritative local copy |

---

## Goal

Replace the current per-endpoint fetching with a local budget replica:

- Fetch the **entire budget** in a single API call (initial sync)
- Use delta sync (`last_knowledge_of_server`) for efficient subsequent syncs
- Reduce total API calls while having complete budget data available locally

---

## How Syncing Works

### Sync Triggers

A sync happens when a tool call is made AND any of these conditions are true:

1. **No local budget exists** → Initial sync (full fetch)
2. **Sync interval has passed** → Delta sync
3. **Write operation occurred** → Delta sync (on next read)
4. **Client passed `force_sync: true`** → Delta sync

Syncing is **lazy, not eager** - we don't sync in the background. We sync when a tool call needs data and the conditions above are met.

### Sync Interval

Configured via `YNAB_SYNC_INTERVAL_SECONDS` (default: 600 = 10 minutes).

- If interval > 0: Sync on first tool call after interval has passed
- If interval = 0: Always sync before proceeding with any tool call

### Initial Sync vs Delta Sync

| Scenario            | What Happens                                                |
| ------------------- | ----------------------------------------------------------- |
| No local budget     | Full fetch: `GET /budgets/{id}`                             |
| Local budget exists | Delta fetch: `GET /budgets/{id}?last_knowledge_of_server=X` |

Delta sync returns only entities that changed since the last sync. We merge these changes into our local budget.

### Write Operations

After a write operation (create/update/delete transaction, update category budget, etc.):

1. The write goes directly to the YNAB API
2. We mark `needsSync = true` on the local budget
3. The next read operation triggers a delta sync before returning data

This ensures we have the server's view of the data after our write (in case the server modified anything, like auto-assigning IDs or applying rules).

---

## Sync History (Incremental Backups)

Every sync response is persisted to disk, creating an automatic incremental backup trail.

### Directory Structure

```
~/.config/ynab-mcp-deluxe/
└── sync-history/
    └── [budgetId]/
        ├── 20260125T143022Z-abc123-full.json    # Initial sync
        ├── 20260125T153022Z-abc123-delta.json   # Delta sync (10 min later)
        ├── 20260125T154500Z-abc123-delta.json   # Delta sync (after write)
        └── ...
```

### Filename Format

```
YYYYMMDDTHHMMSSZ-[budgetId]-[full|delta].json
```

- Timestamp in ISO 8601 format (UTC)
- Budget ID for easy identification
- `full` for initial sync, `delta` for subsequent syncs

### What's Stored

**Full sync file**: Complete budget response from `GET /budgets/{id}`

```json
{
  "sync_type": "full",
  "synced_at": "2026-01-25T14:30:22Z",
  "server_knowledge": 12345,
  "budget": {
    /* entire budget object */
  }
}
```

**Delta sync file**: Only changes since last sync

```json
{
  "sync_type": "delta",
  "synced_at": "2026-01-25T15:30:22Z",
  "previous_server_knowledge": 12345,
  "server_knowledge": 12350,
  "budget": {
    /* only changed entities */
  }
}
```

### Benefits

1. **Automatic backups**: Every sync is a point-in-time snapshot
2. **Change history**: Delta files show exactly what changed and when
3. **Debugging**: Can replay sync history to understand state evolution
4. **Recovery**: Can reconstruct local budget from sync history if needed

### Note on backup.ts

The existing `src/backup.ts` provides on-demand full budget backups. With sync history in place, this becomes less critical for day-to-day operation, but we'll keep it around for:

- Explicit user-triggered backups via `backup_budget` tool
- Different backup location/format if needed in future

---

## Data Structure

### LocalBudget

```typescript
interface LocalBudget {
  // Budget identity
  budgetId: string;
  budgetName: string;

  // Budget data (from full budget endpoint)
  accounts: Account[];
  categories: Category[];
  categoryGroups: CategoryGroupWithCategories[];
  payees: Payee[];
  payeeLocations: PayeeLocation[];
  months: MonthDetail[];
  transactions: TransactionSummary[];
  subtransactions: SubTransaction[];
  scheduledTransactions: ScheduledTransactionSummary[];
  scheduledSubtransactions: ScheduledSubTransaction[];

  // Lookup maps (rebuilt after each sync)
  accountById: Map<string, Account>;
  accountByName: Map<string, Account>; // lowercase name → account
  categoryById: Map<string, Category>;
  categoryByName: Map<string, Category>; // lowercase name → category
  categoryGroupNameById: Map<string, string>;
  payeeById: Map<string, Payee>;

  // Sync metadata
  serverKnowledge: number; // For delta sync
  lastSyncedAt: Date; // When we last synced
  needsSync: boolean; // True after write operations

  // Budget settings
  currencyFormat: CurrencyFormat | null;
}
```

### Configuration

```typescript
// Environment variable
YNAB_SYNC_INTERVAL_SECONDS = 600; // Default: 10 minutes. 0 = always sync.
```

---

## API Changes

### Tool Parameter

Rename `force_refresh` → `force_sync` on all read tools:

```typescript
force_sync: z
  .boolean()
  .default(false)
  .optional()
  .describe('Sync with YNAB server before returning data'),
```

### Server Instructions

Update to reflect sync model:

```typescript
instructions: `MCP server for YNAB budget management.

Syncing: The server maintains a local copy of your budget that syncs with YNAB
periodically (default: every 10 minutes). Use force_sync: true on any read tool
to sync immediately before returning data.`,
```

---

## Internal Architecture

### YnabClient Changes

```typescript
class YnabClient {
  // Local budgets by budget ID
  private localBudgets = new Map<string, LocalBudget>();

  // Sync interval in milliseconds (from env var)
  private syncIntervalMs: number;

  /**
   * Ensures we have a synced local budget.
   * Syncs if: no local budget, interval passed, needsSync flag, or forceSync.
   */
  private async ensureSynced(budgetId: string, forceSync?: boolean): Promise<LocalBudget>

  /**
   * Performs initial sync - full budget fetch, no delta.
   */
  private async initialSync(budgetId: string): Promise<LocalBudget>

  /**
   * Performs delta sync - fetches only changes since last sync.
   */
  private async deltaSync(localBudget: LocalBudget): Promise<LocalBudget>

  /**
   * Merges delta response into existing local budget.
   */
  private mergeDelta(localBudget: LocalBudget, delta: BudgetDelta): LocalBudget

  /**
   * Rebuilds lookup maps from arrays.
   */
  private rebuildLookupMaps(localBudget: LocalBudget): void

  /**
   * Marks local budget as needing sync (called after writes).
   */
  markNeedsSync(budgetId: string): void

  // Public methods - now read from local budget after ensuring synced
  async getAccounts(budgetId: string, options?: { forceSync?: boolean; includeClosed?: boolean }): Promise<...>
  async getCategories(budgetId: string, options?: { forceSync?: boolean; includeHidden?: boolean }): Promise<...>
  async getPayees(budgetId: string, options?: { forceSync?: boolean }): Promise<...>
  async getTransactions(budgetId: string, options?: { forceSync?: boolean; ... }): Promise<...>
  // etc.
}
```

### Sync Decision Logic

```typescript
private async ensureSynced(budgetId: string, forceSync?: boolean): Promise<LocalBudget> {
  const localBudget = this.localBudgets.get(budgetId);

  // No local budget? Initial sync.
  if (!localBudget) {
    return await this.initialSync(budgetId);
  }

  // Force sync requested?
  if (forceSync) {
    return await this.deltaSync(localBudget);
  }

  // Marked as needing sync (after write)?
  if (localBudget.needsSync) {
    return await this.deltaSync(localBudget);
  }

  // Sync interval passed?
  const msSinceSync = Date.now() - localBudget.lastSyncedAt.getTime();
  if (msSinceSync >= this.syncIntervalMs) {
    return await this.deltaSync(localBudget);
  }

  // Local budget is fresh enough
  return localBudget;
}
```

### Delta Merge Logic

```typescript
/**
 * Merges an array of entities from a delta response into existing array.
 * Handles adds, updates, and deletes (deleted: true).
 */
function mergeEntityArray<T extends {id: string; deleted?: boolean}>(
  existing: T[],
  delta: T[],
): T[] {
  // Build map from existing
  const byId = new Map(existing.map((e) => [e.id, e]));

  // Apply delta
  for (const item of delta) {
    if (item.deleted) {
      byId.delete(item.id);
    } else {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values());
}
```

---

## Implementation Plan

### Phase 1: Rename and Restructure

- [ ] Rename `BudgetCache` → `LocalBudget` in types and code
- [ ] Rename `force_refresh` → `force_sync` in all tools
- [ ] Add `serverKnowledge`, `lastSyncedAt`, `needsSync` to `LocalBudget`
- [ ] Add `YNAB_SYNC_INTERVAL_SECONDS` configuration
- [ ] Update server instructions

### Phase 2: Sync History Persistence

- [ ] Create `src/sync-history.ts` module
- [ ] Implement `getSyncHistoryDir(budgetId)` - returns path to budget's sync history folder
- [ ] Implement `ensureSyncHistoryDir(budgetId)` - creates directory if needed
- [ ] Implement `generateSyncFilename(budgetId, syncType)` - generates timestamped filename
- [ ] Implement `persistSyncResponse(budgetId, syncType, serverKnowledge, budget)` - writes sync to disk
- [ ] Add `previous_server_knowledge` tracking for delta files

### Phase 3: Sync Infrastructure

- [ ] Implement `ensureSynced()` with sync decision logic
- [ ] Implement `initialSync()` - full budget fetch, persist to sync history
- [ ] Implement `deltaSync()` - fetch with `last_knowledge_of_server`, persist to sync history
- [ ] Implement `mergeDelta()` - merge delta into local budget
- [ ] Implement `mergeEntityArray()` - generic array merge helper
- [ ] Implement `rebuildLookupMaps()` - rebuild Maps after merge

### Phase 4: Refactor Read Methods

- [ ] Update `getAccounts()` - call `ensureSynced()`, read from local budget
- [ ] Update `getCategories()` - call `ensureSynced()`, read from local budget
- [ ] Update `getPayees()` - call `ensureSynced()`, read from local budget
- [ ] Update `getTransactions()` - call `ensureSynced()`, filter from local budget
- [ ] Update `getScheduledTransactions()` - read from local budget
- [ ] Update `getBudgetMonths()` - read from local budget
- [ ] Update `getBudgetMonth()` - read from local budget

### Phase 5: Wire Up Write Operations

- [ ] After `updateTransactions()` - call `markNeedsSync()`
- [ ] After `createTransactions()` - call `markNeedsSync()`
- [ ] After `deleteTransaction()` - call `markNeedsSync()`
- [ ] After `importTransactions()` - call `markNeedsSync()`
- [ ] After `updateCategoryBudget()` - call `markNeedsSync()`

### Phase 6: Testing

- [ ] Test initial sync (no local budget)
- [ ] Test delta sync (local budget exists)
- [ ] Test sync interval logic
- [ ] Test `force_sync` parameter
- [ ] Test `needsSync` after writes
- [ ] Test delta merge (adds, updates, deletes)
- [ ] Test interval = 0 (always sync)
- [ ] Test sync history files are created with correct format
- [ ] Test full vs delta sync files contain expected data

---

## Files to Modify

| File                  | Changes                                                    |
| --------------------- | ---------------------------------------------------------- |
| `src/ynab-client.ts`  | Major refactor - LocalBudget, sync logic, delta merge      |
| `src/server.ts`       | Rename `force_refresh` → `force_sync`, update instructions |
| `src/types.ts`        | Add/update types for LocalBudget, SyncHistoryEntry         |
| `src/sync-history.ts` | **New file** - sync history persistence utilities          |

---

## Risks & Mitigations

| Risk                                | Mitigation                                     |
| ----------------------------------- | ---------------------------------------------- |
| Delta merge bugs cause drift        | Future: add drift detection, log discrepancies |
| Large budgets = large initial sync  | Accept for now, optimize later if needed       |
| Complex merge logic for nested data | Start simple, handle edge cases as found       |

---

## Future Enhancements

1. **Drift Detection**: Periodic full sync to verify local budget integrity, log warnings if discrepancies found (internal only, not surfaced to client)

2. **Fully Offline Mode**: For extended sessions - sync once at start, update local budget directly on writes without re-syncing. Assumes single-user access.

3. **Selective Sync**: Option to exclude old transactions from sync to reduce payload size.

4. **Force Full Sync**: `force_sync: "full"` to bypass delta and do complete re-fetch if delta sync is suspected of causing drift.

---

## Terminology Reference

| Old Term               | New Term                   |
| ---------------------- | -------------------------- |
| Cache                  | Local Budget               |
| BudgetCache            | LocalBudget                |
| Cached                 | Synced                     |
| force_refresh          | force_sync                 |
| lastFetchedAt          | lastSyncedAt               |
| needsRefresh           | needsSync                  |
| YNAB_CACHE_TTL_SECONDS | YNAB_SYNC_INTERVAL_SECONDS |
| Invalidate cache       | Mark needs sync            |
| Cache miss             | Initial sync needed        |
| Refresh                | Sync                       |

---

## Progress Log

- 2026-01-25: Initial plan created
- 2026-01-25: Revised with local replica mental model and sync terminology
