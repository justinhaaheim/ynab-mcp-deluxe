# OpenAPI Codegen Research

**Date:** 2026-01-21
**Goal:** Research tools for auto-generating TypeScript types and mock data/endpoints from OpenAPI specs

## Context

- YNAB API OpenAPI spec: `https://api.ynab.com/papi/open_api_spec.yaml`
- Currently using `ynab@2.10.0` npm package (pre-generated from OpenAPI)
- Custom enriched types defined in `src/types.ts`
- Want to auto-generate for easier maintenance when API updates
- Runtime: Bun, Test framework: Vitest

---

## TypeScript Type Generation Tools

### 1. openapi-typescript (Recommended for Types Only)

**URL:** https://openapi-ts.dev/ | [GitHub](https://github.com/openapi-ts/openapi-typescript)

**Key Features:**

- Zero runtime cost - generates static TypeScript types
- Supports OpenAPI 3.0 and 3.1
- Can fetch from remote URLs directly
- Fast - generates types for huge schemas in milliseconds
- Works anywhere TypeScript runs

**Installation:**

```bash
npm i -D openapi-typescript typescript
```

**Usage:**

```bash
# From remote URL
npx openapi-typescript https://api.ynab.com/papi/open_api_spec.yaml -o ./src/ynab-api-types.d.ts

# From local file
npx openapi-typescript ./path/to/schema.yaml -o ./path/to/types.d.ts
```

**Pros:**

- Simple, focused tool (does one thing well)
- No runtime dependencies
- Actively maintained
- Part of larger ecosystem (openapi-fetch, openapi-react-query)

**Cons:**

- Types only - no mock generation
- Generated types follow OpenAPI structure (paths/components) which may need adapting

---

### 2. @hey-api/openapi-ts (Full-Featured)

**URL:** https://github.com/hey-api/openapi-ts

**Key Features:**

- Used by Vercel, PayPal, OpenCode
- Generates SDKs, Zod schemas, TanStack Query hooks
- 20+ plugins available
- Supports 7 HTTP clients (Fetch, Axios, Ky, etc.)
- MSW plugin coming soon

**Installation:**

```bash
npm i -D @hey-api/openapi-ts
```

**Usage:**

```bash
npx @hey-api/openapi-ts -i https://api.ynab.com/papi/open_api_spec.yaml -o src/client
```

**Pros:**

- Comprehensive - generates types, client, and validation schemas
- Zod schema generation (useful for our existing Zod usage)
- Active development, enterprise adoption

**Cons:**

- Does NOT follow semantic versioning (pin exact versions)
- More complex than simple type generation
- MSW mock generation not yet available

---

### 3. OpenAPI Generator (Official)

**URL:** https://openapi-generator.tech/

**Key Features:**

- Official OpenAPI tooling
- 11 TypeScript generators available
- Can generate full clients, types, and more

**Pros:**

- Most comprehensive option
- Well-documented
- Large community

**Cons:**

- Java dependency (requires JRE)
- More complex setup
- Generated code can be verbose

---

## Mock Data/Handler Generation Tools

### 4. Orval (Recommended for MSW Mocks)

**URL:** https://orval.dev/ | [MSW Guide](https://orval.dev/guides/msw)

**Key Features:**

- Generates TypeScript types AND MSW handlers
- Uses @faker-js/faker for realistic data
- Generates three types of functions:
  1. **Mock Data Generators**: `getShowPetByIdResponseMock({ name: 'override' })`
  2. **Mock Handlers**: Binds mock data to MSW HTTP handlers
  3. **Handler Aggregators**: `setupServer(...getPetsMock())`

**Installation:**

```bash
npm i -D orval @faker-js/faker msw
```

**Configuration (orval.config.ts):**

```typescript
export default defineConfig({
  ynab: {
    output: {
      mode: 'single',
      target: './src/generated/ynab-client.ts',
      schemas: './src/generated/model',
      mock: true, // Enable MSW mock generation
    },
    input: {
      target: 'https://api.ynab.com/papi/open_api_spec.yaml',
    },
  },
});
```

**Pros:**

- All-in-one: types + client + mocks
- Native MSW integration
- Can use OpenAPI examples for mock values
- Configurable delay and response options

**Cons:**

- Default client uses Axios (configurable)
- More setup required than simple type generation

---

### 5. msw-auto-mock (Simple MSW Generation)

**URL:** https://github.com/zoubingwu/msw-auto-mock | [npm](https://www.npmjs.com/package/msw-auto-mock)

**Key Features:**

- CLI tool to generate MSW handlers from OpenAPI
- No installation required (npx)
- Supports AI-powered mock generation (OpenAI, Azure, Anthropic)
- Static or dynamic mock modes

**Usage:**

```bash
# Generate mocks directly
npx msw-auto-mock https://api.ynab.com/papi/open_api_spec.yaml -o ./src/mocks

# With options
npx msw-auto-mock openapi.yaml -o ./mock --base-url https://api.ynab.com
```

**CLI Options:**

- `-t, --includes <keywords>`: Include only matching endpoints
- `-e, --excludes <keywords>`: Exclude matching endpoints
- `--static`: Generate static mocks (default is dynamic with faker)
- `-c, --codes <codes>`: Status codes to generate (e.g., "200,201,400")

**Pros:**

- Zero config - just run with npx
- AI-powered mock generation option
- Flexible filtering

**Cons:**

- Less integrated than Orval
- Separate tool from type generation

---

### 6. Prism (Mock Server)

**URL:** https://stoplight.io/open-source/prism | [GitHub](https://github.com/stoplightio/prism)

**Key Features:**

- Full HTTP mock server from OpenAPI spec
- Validation proxy for contract testing
- Supports OpenAPI v2.0, v3.0, v3.1, and Postman Collections
- Dynamic data generation with Faker.js
- Request validation against spec

**Installation:**

```bash
npm install -g @stoplight/prism-cli
```

**Usage:**

```bash
# Start mock server
prism mock https://api.ynab.com/papi/open_api_spec.yaml
# Server runs on http://localhost:4010

# Dynamic mode (faker data)
prism mock -d https://api.ynab.com/papi/open_api_spec.yaml
```

**Custom Faker via x-faker extension:**

```yaml
properties:
  name:
    type: string
    x-faker: name.firstName
```

**Pros:**

- Full server - can be used for manual testing
- Validates requests AND responses
- Great for frontend development before backend is ready

**Cons:**

- Separate running process
- Better for dev/integration than unit testing
- Requires spec to have good examples/schemas

---

### 7. @7nohe/openapi-mock-json-generator (JSON Only)

**URL:** https://www.npmjs.com/package/@7nohe/openapi-mock-json-generator

**Key Features:**

- Generates static JSON mock files from OpenAPI
- Lightweight - just data, no handlers

**Usage:**

```bash
npx @7nohe/openapi-mock-json-generator -i openapi.yaml -o ./mocks
```

**Pros:**

- Simple output (just JSON files)
- Can be used with any test framework

**Cons:**

- No handler generation
- Static data only

---

## Recommendations for This Project

### Option A: Type Generation + Orval (Recommended)

**For comprehensive mock support with MSW integration:**

1. Use **Orval** as the primary tool:

   - Generates TypeScript types
   - Generates MSW handlers
   - Generates faker-based mock data
   - Single source of truth from OpenAPI spec

2. Add npm scripts:

   ```json
   {
     "scripts": {
       "generate:api": "orval",
       "generate:api:watch": "orval --watch"
     }
   }
   ```

3. Integration with Vitest:

   ```typescript
   // tests/setup.ts
   import {setupServer} from 'msw/node';
   import {getYnabMock} from './generated/ynab-mocks';

   export const server = setupServer(...getYnabMock());

   beforeAll(() => server.listen());
   afterEach(() => server.resetHandlers());
   afterAll(() => server.close());
   ```

**Tradeoffs:**

- Requires more initial setup
- Generated code replaces manual types (may need adapter layer for enriched types)

---

### Option B: openapi-typescript + msw-auto-mock (Simpler)

**For lighter-weight integration:**

1. Use **openapi-typescript** for types:

   ```bash
   npx openapi-typescript https://api.ynab.com/papi/open_api_spec.yaml -o ./src/generated/ynab-api.d.ts
   ```

2. Use **msw-auto-mock** for handlers:

   ```bash
   npx msw-auto-mock https://api.ynab.com/papi/open_api_spec.yaml -o ./src/mocks
   ```

3. Add npm script:
   ```json
   {
     "scripts": {
       "generate:types": "openapi-typescript https://api.ynab.com/papi/open_api_spec.yaml -o ./src/generated/ynab-api.d.ts",
       "generate:mocks": "msw-auto-mock https://api.ynab.com/papi/open_api_spec.yaml -o ./src/mocks"
     }
   }
   ```

**Tradeoffs:**

- Two separate tools to run
- Less integrated experience
- Simpler mental model

---

### Option C: Prism Mock Server (For Integration Testing)

**For testing against a full mock API server:**

1. Keep existing `ynab` npm package for types
2. Use **Prism** for integration tests:

   ```bash
   prism mock -d https://api.ynab.com/papi/open_api_spec.yaml
   ```

3. Point tests at localhost:4010 instead of real API

**Tradeoffs:**

- Separate process to manage
- Better for integration tests than unit tests
- Tests are slower (HTTP overhead)

---

## Considerations for YNAB MCP Project

1. **Enriched Types**: The project has custom enriched types (e.g., `EnrichedTransaction`) that add resolved names. Generated types would be raw API types - need an adapter layer.

2. **ynab npm package**: Already using the official YNAB TypeScript client. Could:

   - Keep it for the API client, generate types/mocks separately
   - Replace it entirely with generated code

3. **Bun Compatibility**: All recommended tools work with Bun runtime.

4. **Spec Updates**: When YNAB updates their API, simply re-run the generation command.

---

## Summary Table

| Tool                | Types | Client | MSW Mocks | Mock Server | Complexity |
| ------------------- | ----- | ------ | --------- | ----------- | ---------- |
| openapi-typescript  | ✅    | ❌     | ❌        | ❌          | Low        |
| @hey-api/openapi-ts | ✅    | ✅     | Coming    | ❌          | Medium     |
| Orval               | ✅    | ✅     | ✅        | ❌          | Medium     |
| msw-auto-mock       | ❌    | ❌     | ✅        | ❌          | Low        |
| Prism               | ❌    | ❌     | ❌        | ✅          | Low        |
| OpenAPI Generator   | ✅    | ✅     | ❌        | ❌          | High       |

---

## Next Steps

1. Decide on approach (A, B, or C)
2. Set up generation scripts in package.json
3. Create adapter layer for enriched types if needed
4. Configure Vitest to use generated mocks
5. Document regeneration process
