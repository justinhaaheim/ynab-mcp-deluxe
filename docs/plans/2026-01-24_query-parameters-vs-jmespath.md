# Query Parameters vs JMESPath

**Date:** 2026-01-24
**Status:** Draft - not yet implemented

## Problem Statement

The current MCP server relies heavily on JMESPath for filtering and projection. While powerful, this creates issues:

1. **LLMs make JMESPath syntax errors** - during testing, several queries returned empty results due to subtle mistakes
2. **Token overhead** - LLM must reason about JMESPath construction each time
3. **Inconsistent behavior** - different models may construct queries differently
4. **User confusion** - JMESPath is powerful but not intuitive for simple operations

## Current State

The server already handles some common operations with dedicated parameters:

| Operation          | Parameter                                                        | Notes |
| ------------------ | ---------------------------------------------------------------- | ----- |
| Transaction status | `status: "uncategorized" \| "unapproved" \| "all"`               | Good  |
| Payee search       | `payee_contains: "amazon"`                                       | Good  |
| Date range         | `since_date`, `until_date`                                       | Good  |
| Sorting            | `sort_by: "newest" \| "oldest" \| "amount_desc" \| "amount_asc"` | Good  |
| Account filter     | `account: {name: "..."}`                                         | Good  |

These are better than requiring JMESPath equivalents.

## Proposed Additions

### 1. Approval Filter

**Current:** Requires JMESPath `[?approved == \`false\`]`

**Proposed:** Add `approved` parameter to `query_transactions`

```typescript
approved: z.boolean()
  .optional()
  .describe(
    'Filter by approval status. true = approved only, false = unapproved only, omit = all',
  );
```

**Note:** This overlaps with `status: "unapproved"`. Consider whether to:

- Keep both (approved is more explicit boolean)
- Remove `unapproved` from status enum
- Document the difference (status=unapproved is API-level, approved is post-filter)

### 2. Flag Filter

**Current:** Requires JMESPath `[?flag_color != null]` or `[?flag_color == 'red']`

**Proposed:** Add `flag_color` parameter

```typescript
flag_color: z.enum([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'any',
])
  .optional()
  .describe('Filter by flag color. Use "any" to get all flagged transactions.');
```

### 3. Cleared Status Filter

**Current:** Requires JMESPath `[?cleared == 'uncleared']`

**Proposed:** Add `cleared` parameter

```typescript
cleared: z.enum(['cleared', 'uncleared', 'reconciled'])
  .optional()
  .describe('Filter by cleared status');
```

### 4. Amount Range Filter

**Current:** Requires JMESPath `[?amount < \`-100000\` || amount > \`100000\`]`

**Proposed:** Add `amount_min` and `amount_max` parameters

```typescript
amount_min: z.number()
  .int()
  .optional()
  .describe(
    'Minimum amount in milliunits (inclusive). Use negative for outflows.',
  );

amount_max: z.number()
  .int()
  .optional()
  .describe(
    'Maximum amount in milliunits (inclusive). Use negative for outflows.',
  );
```

**Example use cases:**

- Large expenses: `amount_max: -100000` (expenses over $100)
- Small transactions: `amount_min: -10000, amount_max: 10000` (under $10 either direction)
- Income only: `amount_min: 1` (positive amounts)

### 5. Field Projection (fields parameter)

**Current:** Requires JMESPath `[*].{id: id, payee: payee_name, amount: amount_currency}`

**Proposed:** Add `fields` parameter for simple projection

```typescript
fields: z.array(z.string())
  .optional()
  .describe(
    'Fields to include in response. If omitted, returns all fields. Example: ["id", "payee_name", "amount_currency", "date"]',
  );
```

**Available fields:**

- `id`, `account_id`, `payee_id`, `category_id`
- `account_name`, `payee_name`, `category_name`, `category_group_name`
- `date`, `amount`, `amount_currency`, `memo`, `cleared`, `approved`, `flag_color`
- `import_id`, `import_payee_name`, `import_payee_name_original`

**Implementation note:** If `fields` is provided and `query` (JMESPath) is also provided, the `fields` parameter should be ignored (JMESPath takes precedence for projection).

## Updated Tool Description

After implementation, the `query_transactions` description would include:

```
**Parameters (all optional):**

budget - Which budget to query

status - Transaction status filter
  - "uncategorized" - no category assigned
  - "unapproved" - not yet approved
  - "all" (default) - all transactions

account - Filter to specific account

since_date / until_date - Date range (YYYY-MM-DD)

payee_contains - Fuzzy payee name match

approved - Filter by approval status (true/false)

cleared - Filter by cleared status ("cleared", "uncleared", "reconciled")

flag_color - Filter by flag ("red", "orange", "yellow", "green", "blue", "purple", "any")

amount_min / amount_max - Amount range in milliunits

sort_by - Sort order

fields - Array of field names to include in response

query - JMESPath for advanced filtering (overrides sort_by and fields)

limit - Max results (default 50)
```

## JMESPath: Keep as Escape Hatch

JMESPath remains valuable for:

1. **Complex boolean logic** - `[?approved == false && flag_color == 'red']`
2. **Nested data access** - `[*].subtransactions[].{...}`
3. **Aggregations** - `max_by(@, &amount)`
4. **Custom sorting** - `sort_by(@, &category_name)`
5. **Computed projections** - transforming data in ways the simple `fields` param can't

Document this in the tool description:

```
**Advanced filtering (JMESPath):**

For complex queries not covered by the parameters above, use the `query` parameter
with a JMESPath expression. When provided, it overrides sort_by and fields.

Examples:
- Unapproved AND flagged: [?approved == `false` && flag_color != null]
- Top 5 by amount: sort_by(@, &amount) | [-5:]
- Flatten subtransactions: [*].subtransactions[]
```

## Alternative Considered: MCP Prompt for Recipes

Could add an MCP prompt template called `ynab-query-recipes` that LLMs can call to get common JMESPath patterns. This would:

- Serve as documentation accessible to the LLM
- Not require code changes for new recipes
- Be less reliable than dedicated parameters

**Decision:** Dedicated parameters are better for common operations. A recipes prompt could supplement but not replace.

## Implementation Order

1. Add `approved` parameter (simplest, high value)
2. Add `cleared` parameter (simple)
3. Add `flag_color` parameter (simple)
4. Add `amount_min` / `amount_max` parameters (moderate complexity)
5. Add `fields` parameter (most complex - needs field validation)

Each can be implemented and tested independently.

## Migration / Breaking Changes

None - all new parameters are optional and additive. Existing queries continue to work.

## Testing

For each new parameter:

1. Unit test the filter logic
2. Integration test with mock server
3. Verify interaction with JMESPath (JMESPath should override/be applied after)

## Open Questions

1. Should `fields` validate that requested fields exist, or silently ignore invalid ones?
2. Should `approved: false` be redundant with `status: "unapproved"` or should we pick one?
3. Should amount filters use milliunits (consistent with API) or currency (user-friendly)?
