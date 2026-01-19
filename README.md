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
