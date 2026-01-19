# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server for YNAB integration built with FastMCP, TypeScript, and Bun.

## Commands

```bash
bun run signal       # Run before every commit: TypeScript + ESLint + Prettier
bun run dev          # Start FastMCP dev server with CLI interaction
bun run test         # Run tests (Vitest)
bun run build        # Compile TypeScript to dist/
bun run lint:fix     # Auto-fix linting issues
bun run prettier     # Auto-format code
```

## Architecture

```
src/
  server.ts      # Main MCP server entry point - defines tools, resources, prompts
  *.ts           # Utility modules
  *.test.ts      # Tests co-located with source (Vitest)
```

### MCP Server Components

The server exposes three types of capabilities:
- **Tools**: Functions AI can call (add via `server.addTool({...})`)
- **Resources**: Data that can be accessed (add via `server.addResource({...})`)
- **Prompts**: Reusable templates (add via `server.addPrompt({...})`)

Use Zod schemas for parameter validation on tools and prompts.

## Code Conventions

- **No barrel files**: Never use `index.ts` re-exports. Import directly from specific files.
- **ESM modules**: Use `.js` extensions in imports (e.g., `import {add} from './add.js'`)
- **Strict TypeScript**: All strict flags enabled including `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature`

## Commit Workflow

1. Run `bun run signal` before committing (pre-commit hook enforces this)
2. Call `git add` and `git commit` separately
3. Use single quotes in commit messages: `git commit -m 'message'`

## Runtime

- **Runtime/Package Manager**: Bun (not npm/yarn)
- **Module System**: ESM throughout
