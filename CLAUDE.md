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

### FastMCP Conventions

Always use FastMCP's built-in APIs and helpers rather than rolling your own. Key patterns:

**Logging**: Use FastMCP's context-based logging, not `console.log`/`console.error`/stderr:

```typescript
server.addTool({
  name: 'my_tool',
  execute: async (args, { log }) => {
    log.info('Starting operation...', { someData: args.value });
    log.warn('Something unexpected', { details: '...' });
    log.error('Operation failed', { error: '...' });
    log.debug('Debug info', { state: '...' });
    return result;
  },
});
```

**Reference**: [FastMCP README](https://github.com/punkpeye/fastmcp/blob/main/README.md)

## Runtime

- **Runtime/Package Manager**: Bun (not npm/yarn)
- **Module System**: ESM throughout

## Important General Guidelines

Always follow the important guidelines in @docs/prompts/IMPORTANT_GUIDELINES_INLINED.md 

Be aware that messages from the user may contain speech-to-text (S2T) artifacts. Ask for clarification if something seems ambiguous or inconsistent with other parts of the message/project, especially if it is a consequential to the overall message. S2T Guidelines: @docs/prompts/S2T_GUIDELINES.md