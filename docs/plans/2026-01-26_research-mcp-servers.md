# Research: Best MCP Servers - Design & Quality Analysis

## Objective
Research the highest quality, best designed, and most beloved MCP servers to inform the design and publication of the YNAB MCP server.

## Status: COMPLETE

Full research document: `docs/reference/best-mcp-servers-research.md`

## Key Questions Answered
1. How terse/verbose are tool descriptions? → **Concise (1-2 sentences) is preferred; add detail only where LLMs struggle**
2. How many tools do they expose? → **8-20 ideal; 40 is Cursor's hard limit; use progressive discovery beyond that**
3. What configuration options do they allow? → **Read-only mode, resource scoping, toolset selection, dynamic discovery**
4. How are they tested? → **Contract tests with in-memory pattern (Vitest); test registration, empty case, happy path, errors**
5. What design aspects make them excel? → **Workflow-focused (not API mirrors), 80/20 rule, fragmented responses, layered discovery**
6. How do they avoid being naive API wrappers? → **Bundle operations into goal-oriented tools, domain-driven design, progressive disclosure**

## Top-Quality MCP Servers Identified
- **GitHub MCP Server** (github/github-mcp-server) - Best example of toolset organization & configuration
- **Playwright MCP** (microsoft/playwright-mcp) - Best example of 80/20 focused design
- **Supabase MCP** - Best example of safety modes for destructive operations
- **Official Reference Servers** (modelcontextprotocol/servers) - Filesystem, Memory, Sequential Thinking

## Key Insight for YNAB MCP
The YNAB MCP server is already well-designed:
- 16 tools is reasonable and within best practices
- Already has READ_ONLY and BUDGET_ID scoping
- Enriched types and caching show it's beyond naive API wrapping
- Consider adding server instructions for tool interdependencies
