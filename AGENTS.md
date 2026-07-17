# Agent Instructions

<!-- br-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`/`bd`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View ready issues (open, unblocked, not deferred)
br ready              # or: bd ready

# List and search
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br search "keyword"   # Full-text search

# Create and update
br create --title="..." --description="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once

# Sync with git
br sync --flush-only  # Export DB to JSONL
br sync --status      # Check sync status
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only open, unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always sync before ending session

<!-- end-br-agent-instructions -->

## Beads workflow (br) — how Justin wants issues tracked

This project uses **beads_rust** (`br`) as the single source of truth for plans,
tasks, and progress. The command reference is above; this section is about _when_
and _why_ to use it.

**ALWAYS use beads for ALL work.** Every task — even trivial ones — gets a bead.
This is non-negotiable: beads provide accountability, trackability, and a durable
audit trail that survives across sessions. **Do NOT write planning documents in
`docs/plans/` or anywhere else, and do NOT use markdown TODO lists.** Use beads.

### Why this matters

Context evaporates between sessions. Without externalized state, resuming work
means rebuilding context from chat history (gone), file diffs (lossy), and memory
(fragile). The fix: **always capture "what's next" at the END of a session, while
context is fresh — not at the START of the next one, when it's gone.**

- Don't end a session with in-progress beads in vague states. Update their notes.
- Don't end without creating beads for the follow-ups you noticed during the work.
- Don't leave the project in a state where "what to work on next" requires reading code.

The hand-off moment (end of session, end of an epic phase, mid-task interrupt) is
the most valuable place to apply this. Treat it as a first-class step.

### When you start work

Decide which case you're in:

1. **Trivial task** (single file edit, simple fix) — create one bead, do the work, close it.
2. **Non-trivial task** (multiple files, real design decisions, multi-session work) —
   create an **epic**, flesh out its description / design / acceptance-criteria /
   notes fields, then break it into **child beads** with `--parent EPIC_ID`
   (sub-beads auto-number as `EPIC_ID.1`, `EPIC_ID.2`, ...). Using `--parent`
   creates the sub-bead AND the parent-child relationship in one step — prefer it
   over `br dep add` for epic / sub-bead links. Share the plan and wait for
   approval before implementing.
3. **Already-planned work** — check `br ready` for the highest-priority unblocked
   bead and claim it (`br update <id> --status=in_progress`).

### During work

- Update status as you go: `in_progress` when claimed, `closed` with a `--reason` when done.
- Discover a follow-up? Create a bead for it immediately.
- Surprises, decisions, dead-ends worth remembering — append to the bead's `notes`.
  The bead is the durable memory; chat history is not.

### When you finish (or hit a stopping point)

Always end with:

1. `br sync --flush-only` — exports the DB to `.beads/issues.jsonl` (committed in git).
2. `git add` your changes (code + `.beads/issues.jsonl`).
3. `git commit` (see the commit guidelines).

For a multi-bead epic handed off mid-stream, give Justin a short handoff message:
the epic id, the branch, what's done, and which bead to claim next.

### When Justin asks "what should I work on?"

- `br ready` — open, unblocked beads ordered by priority.
- `br epic status` — how active epics are progressing.
- Present concrete options with context — don't make him read raw command output.
  Help him pick something that moves toward a meaningful milestone.
