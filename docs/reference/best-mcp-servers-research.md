# Best MCP Servers: Research & Design Analysis

> Research compiled January 2026 to inform the design and publication of high-quality MCP servers.

## Table of Contents

1. [Top-Quality MCP Servers](#top-quality-mcp-servers)
2. [Tool Descriptions: Verbosity Guidelines](#tool-descriptions-verbosity-guidelines)
3. [Number of Tools & Context Window Management](#number-of-tools--context-window-management)
4. [Configuration Options](#configuration-options)
5. [Testing Strategies](#testing-strategies)
6. [Design Principles: Beyond Naive API Wrappers](#design-principles-beyond-naive-api-wrappers)
7. [What Makes MCP Servers Excel](#what-makes-mcp-servers-excel)
8. [Sources](#sources)

---

## Top-Quality MCP Servers

These servers are recognized for **quality and design**, not just popularity:

### Official Reference Implementations

The [official MCP servers repository](https://github.com/modelcontextprotocol/servers) contains reference implementations that demonstrate best practices:

| Server | Purpose | Why It's Notable |
|--------|---------|------------------|
| **[Filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)** | Secure file operations | Foundational server with configurable access controls, directory restrictions, read-only modes |
| **[Fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch)** | Web content retrieval | Efficient LLM-friendly content conversion |
| **[Memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)** | Persistent memory | Knowledge graph-based storage for cross-session context |
| **[Sequential Thinking](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking)** | Complex problem-solving | Dynamic thought sequences for debugging and architectural decisions |
| **[Everything](https://github.com/modelcontextprotocol/servers/tree/main/src/everything)** | Reference/test server | Demonstrates prompts, resources, and tools—useful for testing |

### Enterprise-Quality Servers

| Server | Maintainer | Key Design Strengths |
|--------|------------|---------------------|
| **[GitHub MCP Server](https://github.com/github/github-mcp-server)** | GitHub | Modular toolsets, dynamic discovery, read-only mode, server instructions, tool consolidation |
| **[Playwright MCP](https://github.com/microsoft/playwright-mcp)** | Microsoft | Accessibility-tree based (not pixel-based), deterministic, focused on 80/20 workflows |
| **[Supabase MCP](https://github.com/supabase-community/supabase-mcp)** | Supabase | 20+ tools with safety modes, query categorization (safe/write/destructive), automatic migration scripts |

### What Makes These Stand Out

1. **GitHub MCP Server**: Demonstrates sophisticated configuration patterns—toolsets, dynamic discovery, read-only mode, and tool-specific configuration to minimize context usage
2. **Playwright MCP**: Proves "less is more"—focused on 8 core tools that handle 80% of browser automation workflows
3. **Supabase MCP**: Shows how to handle destructive operations safely with confirmation flows and categorized query types

---

## Tool Descriptions: Verbosity Guidelines

### The Spectrum

The community is split between two approaches:

| Approach | Guidance | Use When |
|----------|----------|----------|
| **Concise** (1-2 sentences) | Most tool descriptions should be 1-2 sentences structured around a verb and resource | Standard tools with obvious behavior |
| **Verbose** (detailed with examples) | Include examples, workflow guidance, parameter details | Complex tools, tools with non-obvious interdependencies |

### Best Practices

1. **Front-load important information**: AI agents may not read entire descriptions. Put critical info first.

2. **Separate concerns**: Tool descriptions explain *what the tool does*; schema descriptions explain *how to use parameters*. Don't mix them.

3. **Be context-aware**: Dynamic descriptions based on actual content/schema help LLMs make better decisions.

### Examples by Quality

**Simple & Clear** (Slack `create_channel`):
```
"Create a new channel."
```

**With Context** (Google Drive `update_drive`):
```
"Update shared drive settings including name, color, and restrictions."
```

**With Workflow Guidance** (Salesforce `create_contact`):
```
"Create a new Salesforce contact. Required workflow: Call discover_required_fields('Contact') first to identify mandatory fields and prevent creation errors."
```

### Critical Constraint

**Every character counts.** Verbose descriptions consume context window tokens. One study found MCP tools consuming 66,000+ tokens before any conversation started—33% of Claude Sonnet's 200k window.

Recommendation: **Start concise, add detail only where LLMs demonstrably struggle.**

---

## Number of Tools & Context Window Management

### The Problem

| Scenario | Token Impact |
|----------|--------------|
| 50+ MCP tools | ~72,000 tokens just for definitions |
| Playwright MCP alone | ~22% of context window |
| Cursor's built-in tools | Already 5-7% of context |

**Cursor hard limit**: 40 MCP tools total across all servers.

### Guidelines

| Tool Count | Guidance |
|------------|----------|
| **1-10 tools** | Ideal for focused servers. Each tool clearly differentiated. |
| **10-20 tools** | Acceptable if well-organized into logical groups |
| **20-40 tools** | Consider dynamic discovery or toolset grouping |
| **40+ tools** | Must implement progressive disclosure or layered architecture |

### Solutions for Large Tool Counts

1. **Toolsets/Groups**: GitHub MCP uses `--toolsets` flag to enable feature groups (repos, issues, pull_requests, actions)

2. **Dynamic Discovery**: Load tools on-demand based on user intent rather than all upfront

3. **Progressive Disclosure Pattern** (Strata):
   - `discover_categories` → identify relevant services
   - `get_category_actions` → get action names without schemas
   - `get_action_details` → full schema only when needed
   - `execute_action` → perform the operation

4. **Semantic Search**: Use vector similarity to return only relevant tools for a query

### Token Reduction Results

| Strategy | Token Reduction |
|----------|-----------------|
| Dynamic toolsets | 96% input reduction |
| Progressive disclosure | Scales to 1000s of tools |
| Code execution pattern | 98.7% reduction (150k → 2k tokens) |

---

## Configuration Options

### Essential Configuration Patterns

Based on the best MCP servers, these configuration options are most valuable:

| Option | Purpose | Example |
|--------|---------|---------|
| **Read-only mode** | Prevent all write operations | `--read-only`, `YNAB_READ_ONLY=true` |
| **Resource scoping** | Limit to specific resources | `YNAB_BUDGET_ID`, allowed directories |
| **Toolset selection** | Enable/disable tool groups | `--toolsets=repos,issues` |
| **Dynamic discovery** | On-demand tool loading | `--dynamic-toolsets` |
| **Safety modes** | Require confirmation for destructive ops | Supabase's write/destructive categorization |

### Environment Variable Security

**Critical**: Never hardcode credentials.

```json
{
  "env": {
    "YNAB_ACCESS_TOKEN": "${YNAB_ACCESS_TOKEN}"
  }
}
```

Best practices:
- Use environment variable references, not literal values
- Store short-lived tokens in secure locations (keychain)
- Never commit configuration files with credentials
- Consider Docker deployment to reduce supply chain risks

### Configuration Architecture

Per the 12-factor app methodology:
- Host application injects environment variables at runtime
- Server logic is decoupled from credentials
- Each server process has isolated environment (security feature)

---

## Testing Strategies

### Test Types for MCP Servers

| Test Type | Purpose | Priority |
|-----------|---------|----------|
| **Registration tests** | Verify primitives are exposed | Must-have |
| **Empty case tests** | Behavior without data | Must-have |
| **Happy path tests** | Main flow validation | Must-have |
| **Error tests** | Exception handling | Must-have (often neglected) |
| **Regression tests** | One per bug fixed | Must-have |

### Testing Philosophy

> "MCPs are contracts. Treat them just like your endpoints."

Focus on the **contract**, not underlying business logic:
- MCP layer = thin translation layer (test via contract tests)
- Business logic = covered by unit tests separately

### Recommended Tools

| Language | Framework | Notes |
|----------|-----------|-------|
| TypeScript | **Vitest** | Faster, native ESM, tight TypeScript integration |
| TypeScript | Jest + mcp-jest | Complete MCP testing toolkit |
| Python | pytest + pytest-asyncio | With in-memory testing pattern |

### In-Memory Testing Pattern (Preferred)

Avoid subprocess overhead and race conditions:

```typescript
// TypeScript with FastMCP
const server = new FastMCP("TestServer");
server.addTool({ name: "calculate", ... });

// Test directly in-memory
async with Client(server) as client:
  const result = await client.call_tool("calculate", { x: 5, y: 3 });
  expect(result).toBe(8);
```

### Test Structure

Mirror MCP primitives in test organization:
```
tests/mcp/
├── tools/
│   ├── create_transaction.test.ts
│   └── get_accounts.test.ts
├── resources/
└── prompts/
```

### Common Testing Pitfalls

| Pitfall | Solution |
|---------|----------|
| Console.log corrupts STDIO | Use FastMCP's context-based logging |
| Timeout failures | Configure longer timeouts or mock slow operations |
| Type mismatches | Test with exact production types (JSON serialization coerces types) |
| Subprocess race conditions | Use in-memory testing pattern |

---

## Design Principles: Beyond Naive API Wrappers

### The Core Problem

> "Think of MCP tools as tailored toolkits that help an AI achieve a particular task, not as API mirrors." — Vercel Engineering

Naively wrapping every API endpoint creates:
- Too many tools for LLMs to choose from
- Excessive context window consumption
- Poor task completion rates (LLM gets confused)

### Design Patterns

#### 1. Workflow-Based Design

**Instead of**: `create_project`, `add_environment_variables`, `add_domain` (3 tools)

**Use**: `deploy_project` (1 tool that handles complete workflow)

Benefits:
- Reduces token consumption
- Improves model reliability
- Fewer failure points

#### 2. The 80/20 Rule

Identify the 20% of functionality that handles 80% of workflows. Playwright MCP's core tools:
- `navigate`, `snapshot`, `click`, `type`, `select`, `press_key`, `wait_for`, `handle_dialog`

That's **8 tools** for browser automation—not 50.

#### 3. Domain-Driven Design

Organize by business capabilities, not technical concerns:
- Tools named for user goals (`check_budget_health`) not API operations (`GET /budgets/{id}`)
- Single responsibility per server domain

#### 4. Fragmented Responses

Return focused fragments, not entire documents:
- Each fragment addresses a specific concept
- Easier for agents to find relevant information
- Reduces token usage

#### 5. Layered/Progressive Discovery

For servers with many capabilities:
```
Layer 1: discover_services()      → "budgets, transactions, accounts"
Layer 2: get_service_actions()    → ["create", "list", "update"]
Layer 3: get_action_schema()      → full parameter schema
Layer 4: execute_action()         → perform operation
```

### Anti-Patterns to Avoid

| Anti-Pattern | Better Approach |
|--------------|-----------------|
| 1:1 API endpoint mapping | Workflow-focused tools |
| Exposing every operation | 80/20 focused toolset |
| All tools loaded upfront | Dynamic/progressive discovery |
| Verbose identical descriptions | Differentiated, concise descriptions |
| Similar/overlapping tools | Clear single-purpose tools |

---

## What Makes MCP Servers Excel

### 6 Principles for Excellent MCP Servers

Based on [FeatBit's analysis](https://www.featbit.co/feature-flag-mcp/principles-for-building-an-fffective-mcp-server):

1. **Fragmentation**: Break documentation/responses into optimized chunks, not whole documents

2. **Layering & Routing**: Hierarchical tool organization with intelligent routing to specialized sub-tools

3. **Composition**: Synthesize information from multiple sources into comprehensive answers

4. **Orthogonality**: Deduplicate overlapping information; present shared concepts once

5. **Recall & Refinement**: Enable iterative improvement through URL references, follow-up hints, progressive disclosure

6. **Cross-Tool Interaction**: Connected ecosystem where tools reference each other naturally

### Technical Excellence Markers

| Aspect | Excellence Indicator |
|--------|---------------------|
| **Security** | Read-only modes, resource scoping, input validation with Zod |
| **Efficiency** | Caching, pagination, minimal tool descriptions |
| **Reliability** | Idempotent operations, deterministic results, proper error handling |
| **Flexibility** | Configurable toolsets, dynamic discovery, multiple safety modes |
| **Observability** | Structured logging (not console.log), error reporting in results |

### Server Instructions

GitHub MCP Server uses "server instructions"—a system prompt that guides the model:
- Tool interdependencies
- Multi-tool workflow patterns
- Best practices for using the server

Consider adding server instructions for complex tool interactions.

---

## Sources

### Official Documentation & Repositories
- [Model Context Protocol Official Site](https://modelcontextprotocol.io/)
- [Official MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [GitHub MCP Server](https://github.com/github/github-mcp-server)
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Supabase MCP](https://github.com/supabase-community/supabase-mcp)

### Design Guidance (High Credibility)
- [Anthropic Engineering: Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [GitHub Blog: Practical Guide to GitHub MCP Server](https://github.blog/ai-and-ml/generative-ai/a-practical-guide-on-how-to-use-the-github-mcp-server/)
- [Klavis AI: Less is More - 4 Design Patterns](https://www.klavis.ai/blog/less-is-more-mcp-design-patterns-for-ai-agents)
- [Speakeasy: Playwright Tool Proliferation Problem](https://www.speakeasy.com/blog/playwright-tool-proliferation)
- [Speakeasy: Reducing Token Usage by 100x](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2)

### Implementation Guidance
- [Nearform: MCP Tips, Tricks, and Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/)
- [Codely: How to Test MCP Servers](https://codely.com/en/blog/how-to-test-mcp-servers)
- [MCPcat: Unit Testing MCP Servers Guide](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/)
- [FeatBit: 6 Principles for Building Effective MCP Servers](https://www.featbit.co/feature-flag-mcp/principles-for-building-an-fffective-mcp-server)

### Discovery Platforms
- [MCP.so](https://mcp.so/) - 3,000+ servers with quality ratings
- [Smithery](https://smithery.ai/) - 2,200+ servers with installation guides
- [MCP Market Leaderboard](https://mcpmarket.com/leaderboards)

---

## Key Takeaways for YNAB MCP Server

1. **Tool Count**: 16 tools is reasonable; ensure each is clearly differentiated
2. **Descriptions**: Keep concise (1-2 sentences); add detail only where LLMs struggle
3. **Configuration**: Already have good patterns (READ_ONLY, BUDGET_ID scoping)
4. **Testing**: Prioritize contract tests, use in-memory testing with Vitest
5. **Design**: Already beyond naive wrapper (enriched types, caching, selectors)
6. **Consider Adding**:
   - Server instructions for tool interdependencies
   - Toolset grouping if tool count grows
   - Progressive disclosure for advanced features
