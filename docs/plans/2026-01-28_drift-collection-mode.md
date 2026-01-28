# Drift Collection Mode

## Goal

Unblock development by always using full sync (guaranteed correct), while passively collecting drift data for later analysis.

## Design

### Behavior

1. **Always do full sync** - Full budget is the source of truth
2. **Also fetch delta beforehand** (when we have serverKnowledge from previous sync)
3. **Merge delta** into previous budget to get "merged" result
4. **Run drift detection** comparing merged vs full
5. **When drift detected** (at sample rate): Save artifacts to folder
6. **Return full budget** regardless of drift result

### Artifacts to Save (on drift)

- `previous-full.json` - The previous full budget (base for merge)
- `delta-response.json` - The delta API response
- `merged-budget.json` - Result of merging delta into previous
- `full-response.json` - The new full fetch (truth)
- `differences.json` - The diff output
- `summary.json` - Metadata (timestamp, budgetId, counts, etc.)

### Location

`~/.config/ynab-mcp-deluxe/drift-snapshots/{timestamp}-{budgetId}/`

### Env Vars

- `YNAB_DRIFT_SAMPLE_RATE` - Sample 1 in N drift occurrences (default: 1 = all)

## Implementation Plan

- [x] Add `YNAB_DRIFT_SAMPLE_RATE` env var helper
- [x] Create drift snapshot saving function
- [x] Modify sync logic in ynab-client.ts to:
  - Store previous full response
  - Fetch delta (if have serverKnowledge)
  - Merge delta
  - Fetch full
  - Run drift detection
  - Save snapshot if drift detected (at sample rate)
  - Return full budget
- [ ] Test with real API

## Progress

- 2026-01-28: Started implementation
- 2026-01-28: Implemented drift collection mode:
  - Created src/drift-snapshot.ts with snapshot saving logic
  - Rewrote getLocalBudgetWithSync() to always use full sync
  - Added drift detection that compares merged (delta) vs full
  - Snapshots saved to ~/.config/ynab-mcp-deluxe/drift-snapshots/
  - All tests pass (126)
