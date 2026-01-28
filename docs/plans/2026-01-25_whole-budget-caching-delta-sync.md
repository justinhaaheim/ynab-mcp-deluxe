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
- 2026-01-26: Finalized implementation plan after discussion

---

## Finalized Implementation Details (2026-01-26)

### Key Decisions

1. **Include transactions in full budget fetch** - LocalBudget will contain all data from `/budgets/{id}`
2. **UUID alone for sync history directories** - Keep it simple
3. **Disable auto-backup** - Sync history provides continuous incremental backups
4. **Function name: `getLocalBudgetWithSync()`** - Explicit about what it does
5. **forceSync option: `{forceSync: 'full' | 'delta'}`** - Allows forcing full re-fetch for sanity checks
6. **Performance timing logs** - Capture API response time and merge operation time

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    YnabClient                        │
│  (public API: getAccounts(), getTransactions(), etc) │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              getLocalBudgetWithSync()
                       │
         ┌─────────────┴─────────────┐
         │       SyncProvider        │  ← abstraction
         └─────────────┬─────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐
│    Api     │  │   Static   │  │  (Future)  │
│  Sync      │  │   JSON     │  │ MultiEndpt │
│ (default)  │  │  (testing) │  │   Sync     │
└────────────┘  └────────────┘  └────────────┘
```

### New Files

- `src/types.ts` - Add `LocalBudget`, `SyncHistoryEntry`, `SyncProvider` interfaces
- `src/sync-history.ts` - Sync history persistence utilities
- `src/local-budget.ts` - LocalBudget building and merging logic
- `src/sync-providers.ts` - SyncProvider implementations

### getLocalBudgetWithSync() Options

```typescript
interface GetLocalBudgetOptions {
  /**
   * Force a sync operation:
   * - 'full': Do a complete re-fetch (useful for sanity checks, suspected drift)
   * - 'delta': Force delta sync even if interval hasn't passed
   * - undefined: Let sync policy decide
   */
  forceSync?: 'full' | 'delta';
}
```

### Sync Policy Logic

```typescript
function shouldSync(
  budget: LocalBudget | null,
  options: GetLocalBudgetOptions,
): 'full' | 'delta' | 'none' {
  // Force full sync
  if (options.forceSync === 'full') return 'full';

  // No local budget yet
  if (budget === null) return 'full';

  // Force delta sync
  if (options.forceSync === 'delta') return 'delta';

  // Write happened - need to sync
  if (budget.needsSync) return 'delta';

  // Check interval
  const elapsed = Date.now() - budget.lastSyncedAt.getTime();
  const intervalMs = getSyncIntervalMs();
  if (elapsed >= intervalMs) return 'delta';

  // Local budget is fresh enough
  return 'none';
}
```

### Performance Timing

Log timing for:

1. API call duration
2. Merge operation duration
3. Lookup map rebuild duration
4. Sync history persistence duration

```typescript
log.info('Sync completed', {
  syncType: 'delta',
  apiDurationMs: 1250,
  mergeDurationMs: 45,
  rebuildMapsDurationMs: 12,
  persistDurationMs: 89,
  totalDurationMs: 1396,
  serverKnowledge: {previous: 12345, new: 12350},
  changesReceived: {transactions: 5, categories: 0, accounts: 0},
});
```

### Sanity Check (Full vs Delta Comparison)

When `forceSync: 'full'` is used after a delta sync, compare key metrics:

- Count of transactions, accounts, categories, payees
- Log discrepancies as warnings

```typescript
log.warn('Budget drift detected', {
  field: 'transactions.length',
  localValue: 1234,
  remoteValue: 1235,
  drift: 1,
});
```

### Static JSON Testing (Future Enhancement)

Environment variable: `YNAB_STATIC_BUDGET_FILE=/path/to/test-budget.json`

When set:

- Load budget from JSON file instead of API
- Reads work normally from LocalBudget
- Writes either:
  - Apply in-memory only (reset on restart)
  - Write to "mutations" overlay file (persistent)
  - Reject with clear error (read-only mock mode)

See ROADMAP.md for tracking.

### Implementation Phases

#### Phase 1: Types & Foundation

- [x] Define `LocalBudget` interface in `types.ts`
- [x] Define `SyncProvider` interface
- [x] Define `SyncHistoryEntry` interface
- [x] Add `YNAB_SYNC_INTERVAL_SECONDS` env var handling
- [x] Remove `YNAB_AUTO_BACKUP` env var handling

#### Phase 2: Sync History Persistence (`src/sync-history.ts`)

- [x] `getSyncHistoryDir(budgetId)` - returns directory path
- [x] `ensureSyncHistoryDir(budgetId)` - creates if needed
- [x] `generateSyncFilename(budgetId, syncType)` - timestamped filename
- [x] `persistSyncResponse(...)` - writes JSON to disk

#### Phase 3: LocalBudget Infrastructure (`src/local-budget.ts`)

- [x] `buildLocalBudget(budgetResponse)` - creates LocalBudget from API response
- [x] `mergeDelta(existing, delta)` - merges delta sync response
- [x] `rebuildLookupMaps(budget)` - rebuilds O(1) lookup Maps
- [x] `mergeEntityArray()` - generic helper for array merging

#### Phase 4: Sync Providers (`src/sync-providers.ts`)

- [x] `SyncProvider` interface
- [x] `ApiSyncProvider` - full sync & delta sync via YNAB API
- [x] `StaticSyncProvider` - stub (loads from JSON, returns same data)

#### Phase 5: Integrate into `ynab-client.ts`

- [x] Replace `budgetCaches` with `localBudgets: Map<string, LocalBudget>`
- [x] Implement `getLocalBudgetWithSync(budgetId, options?)` with sync policy
- [x] Update all read methods to use LocalBudget (8 of 8 COMPLETE - 2026-01-27)
- [x] Update all write methods to call `markNeedsSync()`

#### Phase 6: Remove Auto-Backup

- [x] Remove auto-backup calls from `server.ts`
- [x] Deprecate/remove `performAutoBackupIfNeeded()` in `backup.ts`
- [x] Keep manual `backup_budget` tool

#### Phase 7: API Surface Changes (`server.ts`)

- [x] Rename `force_refresh` → `force_sync`
- [x] Update schema to support `'full' | 'delta' | true | false`
- [x] Update `prepareBudgetRequest()` to call new sync method
- [x] Update server instructions

#### Phase 8: Testing

- [x] Update existing tests (mocks updated for full budget endpoint)
- [x] All 48 existing tests pass
- [x] **Add delta merge tests** - 34 tests in `local-budget.test.ts` (2026-01-26)
- [x] **Add drift detection tests** - 41 tests in `drift-detection.test.ts` (2026-01-26)
- [ ] Add sync policy tests (future enhancement)
- [ ] Add performance timing tests (future enhancement)

### Implementation Status: ✅ Read Method Migration COMPLETE (2026-01-27)

**All read methods now use LocalBudget data:**

- LocalBudget system fully operational
- Delta sync via YNAB's last_knowledge_of_server parameter
- Sync history persistence for incremental backups
- Auto-backup removed (sync history replaces it)
- **All 8 read methods now read from LocalBudget instead of making API calls**

Pushed to branch: `claude/finish-budget-caching-docs-Kw4jr`

---

## ✅ Read Method Migration Status (2026-01-27 - COMPLETE)

### All Methods Using LocalBudget ✅ (8 of 8)

| Method                       | Status      | Notes                                                   |
| ---------------------------- | ----------- | ------------------------------------------------------- |
| `getAccounts()`              | ✅ Complete | Reads from `localBudget.accounts`                       |
| `getCategories()`            | ✅ Complete | Reads from `localBudget.categories`                     |
| `getPayees()`                | ✅ Complete | Reads from `localBudget.payees`                         |
| `getTransactions()`          | ✅ Complete | Reads from `localBudget.transactions` + subtransactions |
| `getTransaction()`           | ✅ Complete | Finds by ID in `localBudget.transactions`               |
| `getScheduledTransactions()` | ✅ Complete | Reads from `localBudget.scheduledTransactions`          |
| `getBudgetMonths()`          | ✅ Complete | Reads from `localBudget.months`                         |
| `getBudgetMonth()`           | ✅ Complete | Finds by month in `localBudget.months`                  |

### Implementation Details

Created `enrichTransactionSummary()` helper that transforms `TransactionSummary` → `EnrichedTransaction`:

1. Looks up account_name, payee_name, category_name using lookup maps
2. Joins subtransactions from flat `localBudget.subtransactions` array
3. Enriches subtransactions with resolved names

All 5 previously-incomplete methods were refactored to use this helper and read from LocalBudget.

---

## 🚨 Post-Implementation Analysis (2026-01-26)

### Critical Uncertainties - Need Validation

**⚠️ IMPORTANT: All testing was done with MSW mocks, NOT the real YNAB API.**

Key assumptions that need real-world validation:

1. **Delta sync behavior**: Does `GET /budgets/{id}?last_knowledge_of_server=X` actually return only changed entities, or the full budget with a new server_knowledge?

2. **Deletion handling**: When entities are deleted, does the API return them with `deleted: true`? For ALL entity types?

3. **Response structure**: Does the delta response match the full budget structure, just with fewer items?

4. **Merge logic correctness**: Does our `mergeEntityArray()` produce the same result as a full re-fetch?

### What's Still Incomplete

| Item                                     | Status                | Priority |
| ---------------------------------------- | --------------------- | -------- |
| ✅ **Read method migration**             | **8 of 8 COMPLETE**   | CRITICAL |
| 🔴 Real API validation                   | Not done              | CRITICAL |
| ✅ Drift detection                       | **IMPLEMENTED**       | HIGH     |
| ✅ `YNAB_ALWAYS_FULL_SYNC` mode          | **IMPLEMENTED**       | HIGH     |
| ✅ Rename `force_refresh` → `force_sync` | **IMPLEMENTED**       | MEDIUM   |
| ✅ Unit tests for merge/drift logic      | **75 tests added**    | MEDIUM   |
| ✅ Security docs & clear_sync_history    | **IMPLEMENTED**       | MEDIUM   |
| 🟡 Performance timing logs               | Partially implemented | LOW      |
| 🟢 Static JSON testing                   | Plan created          | Future   |

### Must-Have Before Production

1. ✅ **Migrate remaining read methods** - All 8 methods now use LocalBudget
2. ✅ **Drift detection with self-healing** - Validates our merge logic against real API
3. ✅ **"Always full sync" mode** - Fallback if delta sync has bugs
4. **🔴 Real API integration testing** - Manual validation needed

### Nice-to-Have Enhancements

| Enhancement                      | Priority | Notes                                     |
| -------------------------------- | -------- | ----------------------------------------- |
| Sync history cleanup (old files) | Low      | Could become disk space issue             |
| Comprehensive merge unit tests   | Medium   | Edge cases for deletions, partial updates |
| SQLite storage for large budgets | Future   | See "Large Budget Considerations" below   |

---

## 🔴 Phase 9: Drift Detection (NEXT)

### Goal

Validate that our delta sync + merge logic produces identical results to a full budget fetch. This is the scaffolding we need to:

1. Test how YNAB's delta sync actually works
2. Verify our merge logic is correct
3. Self-heal if drift is detected

### Three Sources of Budget Data

```
┌─────────────────────────────────────────────────────────────┐
│                     YNAB API                                 │
├─────────────────────────────────────────────────────────────┤
│  1. Delta Query        │  2. Full Query (no server_knowledge)│
│  (with server_knowledge)│     = Source of Truth              │
│  Returns: changes only │     Returns: complete budget        │
└─────────────────────────────────────────────────────────────┘
                    │                        │
                    ▼                        ▼
           ┌───────────────┐        ┌───────────────┐
           │ Local Budget  │        │ Full Budget   │
           │ + Merge Logic │        │ (Truth)       │
           └───────┬───────┘        └───────┬───────┘
                   │                        │
                   └────────┬───────────────┘
                            ▼
                   ┌───────────────┐
                   │   COMPARE     │
                   │  (deep-diff)  │
                   └───────────────┘
```

Note: Source #3 (write operation responses) could theoretically be used to update local state, but we're NOT doing this now. Worth considering in future.

### Implementation Plan

#### Step 1: Add `deep-diff` dependency

```bash
bun add deep-diff
bun add -D @types/deep-diff
```

#### Step 2: Add environment variables

```typescript
// Drift detection mode
YNAB_DRIFT_DETECTION = true; // Default: true in DEV, false in production

// Always do full sync (skip delta optimization entirely)
YNAB_ALWAYS_FULL_SYNC = true; // Default: false
```

#### Step 3: Implement drift detection flow

On every sync (when drift detection enabled):

1. **Do delta query** (with `last_knowledge_of_server`)
2. **Apply merge logic** to local budget → produces "merged budget"
3. **Do full query** (without `last_knowledge_of_server`) → produces "truth budget"
4. **Compare `server_knowledge` values**:
   - If `truth.server_knowledge > merged.server_knowledge`: Log warning that external changes happened between queries
5. **Deep compare** merged vs truth using `deep-diff`
6. **If differences found**:
   - Log detailed warning with diff paths
   - **Self-heal**: Replace local budget with truth budget
7. **If no differences**: Log success, our merge logic is working!

#### Step 4: Drift detection frequency (production)

For production use (after validation):

- Check drift every N syncs OR every M minutes, whichever comes first
- Configurable via env vars:
  ```
  YNAB_DRIFT_CHECK_INTERVAL_SYNCS=10    // Every 10th sync
  YNAB_DRIFT_CHECK_INTERVAL_MINUTES=60  // Or every 60 minutes
  ```

#### Step 5: "Always Full Sync" mode

When `YNAB_ALWAYS_FULL_SYNC=true`:

- Skip delta queries entirely
- Always fetch full budget (no `last_knowledge_of_server`)
- Simple, guaranteed correct, just slower

This is a valid production strategy if delta sync proves unreliable.

### New File: `src/drift-detection.ts`

```typescript
import {diff} from 'deep-diff';
import type {LocalBudget} from './types.js';

interface DriftCheckResult {
  hasDrift: boolean;
  serverKnowledgeMismatch: boolean;
  differences: Array<{
    kind: 'N' | 'D' | 'E' | 'A'; // New, Deleted, Edited, Array
    path: string[];
    lhs?: unknown;
    rhs?: unknown;
  }>;
}

export function checkForDrift(
  mergedBudget: LocalBudget,
  truthBudget: LocalBudget,
): DriftCheckResult;

export function shouldCheckDrift(
  syncCount: number,
  lastDriftCheckAt: Date | null,
): boolean;
```

### Logging Examples

**No drift (success):**

```
✅ Drift check passed - merge logic validated
   serverKnowledge: merged=12350, truth=12350
   entities compared: accounts=5, categories=42, transactions=1234
```

**Server knowledge mismatch (warning):**

```
⚠️ Server knowledge mismatch during drift check
   merged.serverKnowledge: 12350
   truth.serverKnowledge: 12355
   External changes likely occurred between queries.
   Comparison may show expected differences.
```

**Drift detected (error + self-heal):**

```
🚨 DRIFT DETECTED - merge logic produced different result than full fetch
   Differences found: 3

   [1] transactions[42].amount
       merged: -50000
       truth:  -55000

   [2] categories[5].balance
       merged: 150000
       truth:  145000

   [3] transactions[1234] (MISSING)
       truth has transaction not in merged budget

   🔧 Self-healing: Replacing local budget with full fetch result
```

### Phase 9 Checklist

- [x] Add `deep-diff` dependency
- [x] Add `YNAB_DRIFT_DETECTION` env var (default: true)
- [x] Add `YNAB_ALWAYS_FULL_SYNC` env var (default: false)
- [x] Create `src/drift-detection.ts` module
- [x] Implement `checkForDrift()` function
- [x] Implement `shouldPerformDriftCheck()` for production frequency
- [x] Integrate into sync flow in `ynab-client.ts`
- [x] Add clear logging for all scenarios
- [x] Self-heal on drift detection
- [ ] Test with real YNAB API (manual validation needed)

### Phase 9 Status: ✅ IMPLEMENTED (2026-01-26)

Drift detection is now fully implemented and integrated:

- Deep comparison using `deep-diff` library
- Configurable frequency via env vars
- Self-healing when drift is detected
- Detailed logging with emoji indicators

**Next step**: Manual testing with real YNAB API to validate delta sync behavior

---

## 🟡 Large Budget Considerations (Future)

### The Problem

Some YNAB budgets can be 20-50MB when serialized to JSON. Keeping this entirely in memory may be problematic for:

- Running multiple MCP server instances
- Resource-constrained environments
- Very long-running sessions

### Potential Solutions

| Approach                     | Pros                                  | Cons                                 |
| ---------------------------- | ------------------------------------- | ------------------------------------ |
| **Keep in memory** (current) | Simple, fast                          | Memory usage scales with budget size |
| **Filesystem + jq**          | Low memory                            | Shell dependency, slower queries     |
| **SQLite**                   | Fast queries, low memory, single file | Added complexity, schema management  |
| **LevelDB/RocksDB**          | Very fast, key-value                  | Less query flexibility               |

### Recommendation

If we need to address this:

1. **SQLite** is probably the best choice - battle-tested, excellent Node support (`better-sqlite3`), query capabilities match our lookup patterns
2. This is a separate workstream - don't mix with delta sync validation
3. Track in ROADMAP.md

---

---

## 🟢 Phase 10: Static JSON Testing

### Goal

Replace the real YNAB API with a static JSON file for testing purposes. This enables:

1. **Deterministic testing** - Same data every time, no network dependency
2. **Offline development** - Work without YNAB API access
3. **Large budget simulation** - Test with realistic 20-50MB budgets
4. **Edge case testing** - Craft specific scenarios (deletions, splits, etc.)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      SyncProvider                            │
├─────────────────────────────────────────────────────────────┤
│  ApiSyncProvider       │  StaticJsonSyncProvider            │
│  (production)          │  (testing)                          │
├────────────────────────┼────────────────────────────────────┤
│  fullSync() → API      │  fullSync() → Read JSON file       │
│  deltaSync() → API     │  deltaSync() → Read JSON + filter  │
└────────────────────────┴────────────────────────────────────┘
```

### Environment Configuration

```bash
# Path to static budget JSON file
YNAB_STATIC_BUDGET_FILE=/path/to/test-budget.json

# When set, uses StaticJsonSyncProvider instead of ApiSyncProvider
# Implies read-only mode (writes will fail with clear error)
```

### Static JSON File Format

The file should match the response from `GET /budgets/{id}`:

```json
{
  "server_knowledge": 12345,
  "budget": {
    "id": "test-budget-id",
    "name": "Test Budget",
    "accounts": [...],
    "categories": [...],
    "category_groups": [...],
    "payees": [...],
    "payee_locations": [...],
    "months": [...],
    "transactions": [...],
    "subtransactions": [...],
    "scheduled_transactions": [...],
    "scheduled_subtransactions": [...],
    "currency_format": {...}
  }
}
```

### StaticJsonSyncProvider Implementation

```typescript
// src/sync-providers.ts

export class StaticJsonSyncProvider implements SyncProvider {
  private budgetData: BudgetDetail | null = null;
  private serverKnowledge: number = 0;

  constructor(private filePath: string) {}

  private async loadBudget(): Promise<void> {
    if (this.budgetData !== null) return;

    const content = await readFile(this.filePath, 'utf-8');
    const parsed = JSON.parse(content);
    this.budgetData = parsed.budget;
    this.serverKnowledge = parsed.server_knowledge;
  }

  async fullSync(budgetId: string): Promise<SyncResult> {
    await this.loadBudget();
    return {
      budget: this.budgetData!,
      serverKnowledge: this.serverKnowledge,
    };
  }

  async deltaSync(
    budgetId: string,
    lastKnowledge: number,
  ): Promise<SyncResult> {
    // For static testing, delta sync returns empty changes
    // (same as full sync would if nothing changed)
    await this.loadBudget();

    // Return empty arrays for all entity types (no changes)
    return {
      budget: {
        ...this.budgetData!,
        accounts: [],
        categories: [],
        category_groups: [],
        payees: [],
        payee_locations: [],
        months: [],
        transactions: [],
        subtransactions: [],
        scheduled_transactions: [],
        scheduled_subtransactions: [],
      },
      serverKnowledge: this.serverKnowledge,
    };
  }
}
```

### Write Operation Handling

When using static JSON mode, write operations should fail clearly:

```typescript
// In server.ts or ynab-client.ts

function ensureNotStaticMode(operation: string): void {
  if (isStaticJsonMode()) {
    throw new Error(
      `Cannot ${operation} in static JSON mode. ` +
        `Remove YNAB_STATIC_BUDGET_FILE to use real API.`,
    );
  }
}
```

### Test Data Generation

Options for creating test JSON files:

1. **Export from real budget**: Use `backup_budget` tool, then sanitize
2. **Generate synthetic data**: Script to create realistic test budgets
3. **Use existing mock data**: Adapt `src/mocks/handlers.ts` data

### Phase 10 Checklist

- [ ] Add `YNAB_STATIC_BUDGET_FILE` env var handling
- [ ] Implement `StaticJsonSyncProvider` in `sync-providers.ts`
- [ ] Add `isStaticJsonMode()` helper function
- [ ] Update `getSyncProvider()` to return static provider when configured
- [ ] Block write operations in static mode with clear error
- [ ] Add tests for `StaticJsonSyncProvider`
- [ ] Create sample test JSON file in `data/example/`
- [ ] Document in README

### Benefits for Development

1. **No rate limit concerns** - Test freely without hitting YNAB's 200/hour limit
2. **Consistent test data** - Same budget state across test runs
3. **CI/CD friendly** - No secrets needed for testing
4. **Edge case crafting** - Create budgets with specific scenarios

---

## Progress Log

- 2026-01-25: Initial plan created
- 2026-01-25: Revised with local replica mental model and sync terminology
- 2026-01-26: Finalized implementation plan after discussion
- 2026-01-26: Core implementation complete (Phases 1-8)
- 2026-01-26: Post-implementation analysis - identified need for drift detection
- 2026-01-26: Phase 9 (Drift Detection) implemented
- 2026-01-26: Added 75 unit tests (34 local-budget, 41 drift-detection)
- 2026-01-26: Added security docs to README, clear_sync_history tool
- 2026-01-26: Phase 10 (Static JSON Testing) planned
- 2026-01-27: **Read method migration COMPLETE** - All 8 read methods now use LocalBudget data
  - Created `enrichTransactionSummary()` helper for TransactionSummary → EnrichedTransaction
  - Migrated: getTransactions(), getTransaction(), getScheduledTransactions(), getBudgetMonths(), getBudgetMonth()
