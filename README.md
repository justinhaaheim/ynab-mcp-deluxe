# YNAB MCP Deluxe

An MCP server for YNAB integration built with [FastMCP](https://github.com/punkpeye/fastmcp).

## Development

### Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime and package manager

### Getting Started

```bash
bun install
bun run dev
```

### Start the server

```bash
bun run start
```

Or use the dev script to interact with the server using CLI:

```bash
bun run dev
```

### Testing

```bash
bun run test
```

### Linting and Formatting

Run the full signal check (typescript, eslint, prettier):

```bash
bun run signal
```

Individual commands:

```bash
bun run ts-check       # TypeScript type checking
bun run lint           # ESLint
bun run prettier-check # Prettier check
bun run prettier       # Prettier format
bun run lint:fix       # ESLint with auto-fix
```

## Security Considerations

### ⚠️ Sync History Contains Sensitive Financial Data

This server maintains a local sync history to enable efficient delta synchronization with YNAB. **This history contains complete snapshots of your budget data**, including:

- Account names and balances
- Transaction details (payees, amounts, dates, memos)
- Category names and budgeted amounts
- Payee information

**Location:** `~/.config/ynab-mcp-deluxe/sync-history/[budgetId]/`

**Important:**

- This data is stored unencrypted on your local filesystem
- Anyone with access to your user account can read this data
- Consider the security implications before using this on shared systems
- Back up this directory if you need to preserve sync state across reinstalls

### Clearing Sync History

To clear all sync history and force a fresh full sync on next access:

```bash
rm -rf ~/.config/ynab-mcp-deluxe/sync-history/
```

Or use the MCP tool (when available):

```
clear_sync_history
```

## Environment Variables

| Variable                            | Required | Default | Description                                                         |
| ----------------------------------- | -------- | ------- | ------------------------------------------------------------------- |
| `YNAB_ACCESS_TOKEN`                 | Yes      | -       | YNAB API personal access token                                      |
| `YNAB_BUDGET_ID`                    | No       | -       | Hard constraint - only allow access to this budget (safety feature) |
| `YNAB_READ_ONLY`                    | No       | `false` | Set to `true` or `1` to block all write operations                  |
| `YNAB_SYNC_INTERVAL_SECONDS`        | No       | `600`   | How often to sync with YNAB (0 = always sync)                       |
| `YNAB_DRIFT_DETECTION`              | No       | `true`  | Enable drift detection to validate merge logic                      |
| `YNAB_ALWAYS_FULL_SYNC`             | No       | `false` | Skip delta sync, always fetch full budget                           |
| `YNAB_DRIFT_CHECK_INTERVAL_SYNCS`   | No       | `1`     | Check for drift every N syncs                                       |
| `YNAB_DRIFT_CHECK_INTERVAL_MINUTES` | No       | `0`     | Check for drift every N minutes (0 = disabled)                      |
