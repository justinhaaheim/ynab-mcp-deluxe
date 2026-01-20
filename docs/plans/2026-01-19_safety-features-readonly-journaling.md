# Safety Features: Read-Only Mode & Change Journaling

**Date:** 2026-01-19

---

## TL;DR

| Feature               | Purpose                                      | Implementation Complexity |
| --------------------- | -------------------------------------------- | ------------------------- |
| **Read-Only Mode**    | Prevent accidental writes during exploration | Low                       |
| **Change Journaling** | Before/after snapshots of all mutations      | Medium                    |

Both features provide **peace of mind** when operating on real financial data.

---

## 1. Read-Only Mode

### Purpose

Allow users to safely explore their YNAB data without risk of accidental modifications. Useful for:

- Testing/development
- Demonstration purposes
- When AI is exploring data to answer questions
- Users who only want read access

### Design

#### Option A: Environment Variable (Recommended)

```bash
# In MCP config or environment
YNAB_READ_ONLY=true
```

**Pros:**

- Simple configuration
- Doesn't require tool parameter on every call
- Clear server-level policy

**Implementation:**

```typescript
// src/ynab-client.ts

function isReadOnlyMode(): boolean {
  const value = process.env['YNAB_READ_ONLY'];
  return value === 'true' || value === '1';
}

function assertWriteAllowed(operation: string): void {
  if (isReadOnlyMode()) {
    throw new Error(
      `Write operation "${operation}" blocked: Server is in read-only mode. ` +
      `Set YNAB_READ_ONLY=false to enable writes.`
    );
  }
}

// In each write method:
async updateTransactions(...) {
  assertWriteAllowed('update_transactions');
  // ... existing logic
}

async createTransaction(...) {
  assertWriteAllowed('create_transaction');
  // ... existing logic
}
```

#### Option B: Tool Annotation (MCP Native)

MCP tools support a `readOnlyHint` annotation. We already use this:

```typescript
server.addTool({
  name: 'update_transactions',
  annotations: {
    readOnlyHint: false, // Tells clients this modifies data
  },
  // ...
});
```

However, this is just a **hint** to the AI/client - it doesn't enforce anything.

#### Option C: Per-Request Override

Allow read-only mode but permit explicit override:

```typescript
// Tool parameter
parameters: z.object({
  // ... other params
  allow_write: z.boolean().optional().describe(
    'Must be true to execute in read-only mode (confirms intent)'
  ),
}),
```

### Recommendation

**Use Option A (environment variable) as the primary mechanism.**

- It's the simplest and most foolproof
- Can be combined with Option C for explicit override if needed
- The MCP annotation (Option B) should also be set correctly for AI awareness

---

## 2. Change Journaling

### Purpose

Maintain a detailed log of all mutations for:

- **Audit trail** - What changed and when
- **Undo capability** - Know what to reverse
- **Debugging** - Understand unexpected states
- **User confidence** - Transparent about what AI is doing

### Design

#### Journal Entry Structure

```typescript
// src/types.ts

export interface JournalEntry {
  /** Unique entry ID (UUID) */
  id: string;

  /** ISO timestamp when operation executed */
  timestamp: string;

  /** Type of operation */
  operation:
    | 'create_transaction'
    | 'update_transaction'
    | 'update_transactions_batch'
    | 'delete_transaction'
    | 'update_category_budget'
    | 'import_transactions';

  /** Budget context */
  budget: {
    id: string;
    name: string;
  };

  /** State before the change (null for creates) */
  before: unknown;

  /** State after the change (null for deletes, or contains deleted flag) */
  after: unknown;

  /** What specifically changed (for updates) */
  changes?: Record<string, {from: unknown; to: unknown}>;

  /** Any additional context */
  metadata?: {
    /** Number of items affected (for batch operations) */
    affected_count?: number;
    /** IDs of affected entities */
    affected_ids?: string[];
    /** Human-readable summary */
    summary?: string;
  };
}
```

#### Example Journal Entries

**Single Transaction Update:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-01-19T14:32:15.123Z",
  "operation": "update_transaction",
  "budget": {
    "id": "abc123",
    "name": "My Budget"
  },
  "before": {
    "id": "txn-456",
    "date": "2026-01-15",
    "amount": -45.99,
    "payee_name": "Amazon",
    "category_id": null,
    "category_name": null,
    "approved": false,
    "memo": null,
    "flag_color": null
  },
  "after": {
    "id": "txn-456",
    "date": "2026-01-15",
    "amount": -45.99,
    "payee_name": "Amazon",
    "category_id": "cat-789",
    "category_name": "Shopping",
    "approved": true,
    "memo": "Household supplies",
    "flag_color": null
  },
  "changes": {
    "category_id": {"from": null, "to": "cat-789"},
    "category_name": {"from": null, "to": "Shopping"},
    "approved": {"from": false, "to": true},
    "memo": {"from": null, "to": "Household supplies"}
  },
  "metadata": {
    "summary": "Categorized Amazon transaction as Shopping, approved, added memo"
  }
}
```

**Batch Update:**

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2026-01-19T14:35:00.000Z",
  "operation": "update_transactions_batch",
  "budget": {
    "id": "abc123",
    "name": "My Budget"
  },
  "before": [
    {"id": "txn-001", "approved": false, "category_id": null},
    {"id": "txn-002", "approved": false, "category_id": null},
    {"id": "txn-003", "approved": false, "category_id": null}
  ],
  "after": [
    {"id": "txn-001", "approved": true, "category_id": "cat-groceries"},
    {"id": "txn-002", "approved": true, "category_id": "cat-groceries"},
    {"id": "txn-003", "approved": true, "category_id": "cat-groceries"}
  ],
  "metadata": {
    "affected_count": 3,
    "affected_ids": ["txn-001", "txn-002", "txn-003"],
    "summary": "Approved and categorized 3 transactions as Groceries"
  }
}
```

**Create Transaction:**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "timestamp": "2026-01-19T14:40:00.000Z",
  "operation": "create_transaction",
  "budget": {
    "id": "abc123",
    "name": "My Budget"
  },
  "before": null,
  "after": {
    "id": "txn-new-123",
    "date": "2026-01-19",
    "amount": -5.5,
    "payee_name": "Starbucks",
    "category_name": "Coffee",
    "approved": false
  },
  "metadata": {
    "summary": "Created $5.50 transaction at Starbucks"
  }
}
```

#### Storage Options

| Option                   | Pros                                   | Cons                                 |
| ------------------------ | -------------------------------------- | ------------------------------------ |
| **JSONL file**           | Simple, human-readable, grep-able      | No query capability, grows unbounded |
| **SQLite**               | Queryable, efficient, rotatable        | More complex, dependency             |
| **In-memory + response** | No persistence needed, always returned | Lost on restart, no history          |
| **MCP Resource**         | Exposed via MCP protocol               | Requires resource implementation     |

**Recommendation: JSONL file + always include in response**

```typescript
// Configuration
YNAB_JOURNAL_PATH = /path/ot / ynab - changes.jsonl; // Optional, enables persistence
```

#### Implementation Architecture

```typescript
// src/journal.ts

import {randomUUID} from 'crypto';
import {appendFile} from 'fs/promises';

export interface JournalEntry {
  /* ... as defined above */
}

class ChangeJournal {
  private journalPath: string | null;

  constructor() {
    this.journalPath = process.env['YNAB_JOURNAL_PATH'] ?? null;
  }

  async record(
    entry: Omit<JournalEntry, 'id' | 'timestamp'>,
  ): Promise<JournalEntry> {
    const fullEntry: JournalEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Persist to file if configured
    if (this.journalPath !== null) {
      await appendFile(
        this.journalPath,
        JSON.stringify(fullEntry) + '\n',
        'utf-8',
      );
    }

    return fullEntry;
  }

  /**
   * Compute the specific field changes between before and after states
   */
  computeChanges(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Record<string, {from: unknown; to: unknown}> {
    const changes: Record<string, {from: unknown; to: unknown}> = {};

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      const fromVal = before[key];
      const toVal = after[key];

      if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
        changes[key] = {from: fromVal, to: toVal};
      }
    }

    return changes;
  }
}

export const journal = new ChangeJournal();
```

#### Integration with Tools

```typescript
// src/server.ts - update_transactions tool

execute: async (args) => {
  const budgetId = await ynabClient.resolveBudgetId(args.budget);
  const budgetInfo = await ynabClient.getBudgetInfo(budgetId);

  // 1. FETCH BEFORE STATE
  const beforeStates = await Promise.all(
    args.transactions.map(async (update) => {
      const tx = await ynabClient.getTransaction(budgetId, update.id);
      return {
        id: tx.id,
        category_id: tx.category_id,
        category_name: tx.category_name,
        approved: tx.approved,
        memo: tx.memo,
        flag_color: tx.flag_color,
      };
    }),
  );

  // 2. PERFORM THE UPDATE
  const result = await ynabClient.updateTransactions(
    budgetId,
    args.transactions,
  );

  // 3. BUILD AFTER STATE
  const afterStates = result.updated.map((tx) => ({
    id: tx.id,
    category_id: tx.category_id,
    category_name: tx.category_name,
    approved: tx.approved,
    memo: tx.memo,
    flag_color: tx.flag_color,
  }));

  // 4. RECORD TO JOURNAL
  const journalEntry = await journal.record({
    operation: 'update_transactions_batch',
    budget: {
      id: budgetId,
      name: budgetInfo.name,
    },
    before: beforeStates,
    after: afterStates,
    metadata: {
      affected_count: result.updated.length,
      affected_ids: result.updated.map((tx) => tx.id),
      summary: `Updated ${result.updated.length} transaction(s)`,
    },
  });

  // 5. RETURN RESULT WITH JOURNAL ENTRY
  return JSON.stringify(
    {
      result,
      journal: journalEntry, // Always include for transparency
    },
    null,
    2,
  );
};
```

#### Exposing Journal via MCP Resource (Optional)

```typescript
// src/server.ts

server.addResource({
  uri: 'ynab://journal/recent',
  name: 'Recent Changes',
  description: 'Last 50 changes made to YNAB data',
  mimeType: 'application/json',
  load: async () => {
    const entries = await journal.getRecent(50);
    return JSON.stringify(entries, null, 2);
  },
});
```

---

## 3. Combined UX Flow

### Example: AI Categorizes Transactions

```
User: "Categorize my uncategorized Amazon transactions as Shopping"

AI: I'll update those transactions. Here's what will change:

┌─────────────────────────────────────────────────────────────────┐
│  PROPOSED CHANGES                                               │
├─────────────────────────────────────────────────────────────────┤
│  3 transactions will be updated:                                │
│                                                                 │
│  1. Jan 15 - Amazon - $45.99                                    │
│     Category: (none) → Shopping                                 │
│                                                                 │
│  2. Jan 12 - Amazon - $23.50                                    │
│     Category: (none) → Shopping                                 │
│                                                                 │
│  3. Jan 8 - Amazon - $89.00                                     │
│     Category: (none) → Shopping                                 │
└─────────────────────────────────────────────────────────────────┘

[Proceeds to make changes]

AI: Done! Here's the change log:

┌─────────────────────────────────────────────────────────────────┐
│  CHANGE JOURNAL - 2026-01-19T14:32:15Z                          │
├─────────────────────────────────────────────────────────────────┤
│  Operation: update_transactions_batch                           │
│  Budget: My Budget                                              │
│  Affected: 3 transactions                                       │
│                                                                 │
│  Summary: Categorized 3 Amazon transactions as Shopping         │
│                                                                 │
│  Journal ID: 550e8400-e29b-41d4-a716-446655440000               │
│  (Full before/after states saved to journal)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Read-Only Mode Behavior

```
User: "Categorize my Amazon transactions"

AI: I found 3 Amazon transactions to categorize, but the server is
in read-only mode (YNAB_READ_ONLY=true).

Here's what I would have changed:
- Jan 15 - Amazon - $45.99 → Shopping
- Jan 12 - Amazon - $23.50 → Shopping
- Jan 8 - Amazon - $89.00 → Shopping

To apply these changes, disable read-only mode and try again.
```

---

## 4. Implementation Checklist

### Read-Only Mode

- [ ] Add `isReadOnlyMode()` helper in ynab-client.ts
- [ ] Add `assertWriteAllowed()` guard function
- [ ] Apply guard to `updateTransactions()`
- [ ] Apply guard to future write methods
- [ ] Document `YNAB_READ_ONLY` env var in README
- [ ] Return helpful error message when blocked

### Change Journaling

- [ ] Create `src/journal.ts` with JournalEntry type
- [ ] Implement `ChangeJournal` class
- [ ] Add `YNAB_JOURNAL_PATH` env var support
- [ ] Implement `computeChanges()` helper
- [ ] Integrate with `update_transactions` tool
- [ ] Always include journal entry in response
- [ ] Add journal resource (optional)
- [ ] Document journaling in README

---

## 5. Configuration Summary

```bash
# Environment variables

# Read-only mode (blocks all write operations)
YNAB_READ_ONLY=true

# Journal file path (enables persistent logging)
YNAB_JOURNAL_PATH=/path/to/ynab-journal.jsonl

# Existing
YNAB_ACCESS_TOKEN=your-token
YNAB_BUDGET_ID=optional-default-budget  # (proposed in competitive analysis)
```

---

## 6. Future Enhancements

1. **Undo Capability** - Use journal to reverse changes
2. **Dry-Run Mode** - Show what would change without doing it
3. **Change Approval** - Require explicit confirmation for changes
4. **Journal Rotation** - Auto-rotate logs by date/size
5. **Journal Viewer** - MCP resource to browse/search history
6. **Webhook Integration** - Notify external systems of changes
