# Mutation Response Validation

## Goal

Add validation checks after mutation operations to ensure the API response confirms that the correct entity was mutated. This is defensive programming to catch issues like:

- Wrong entity updated due to ID confusion
- Partial failures where some items weren't processed
- API returning unexpected responses

## Current Mutation Operations

| Method                 | Input IDs                   | Response Contains                             | Validation Needed                           |
| ---------------------- | --------------------------- | --------------------------------------------- | ------------------------------------------- |
| `updateTransactions`   | Array of `{id, ...fields}`  | Array of updated transactions                 | Verify all requested IDs were updated       |
| `createTransactions`   | Array of transaction data   | Array of created transactions + duplicate IDs | Verify count matches (excluding duplicates) |
| `deleteTransaction`    | Single `transactionId`      | Deleted transaction                           | Verify returned ID matches requested ID     |
| `importTransactions`   | None (budget-level)         | Count + IDs                                   | No specific validation needed               |
| `createAccount`        | name, type, balance         | Created account                               | Verify returned name/type match request     |
| `updateCategoryBudget` | categoryId, month, budgeted | Updated category                              | Verify returned category ID matches         |

## Implementation Plan

### 1. Create validation helper function

Create a new file `src/mutation-validation.ts` with helper functions:

```typescript
export class MutationValidationError extends Error {
  constructor(
    public operation: string,
    public expected: unknown,
    public actual: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'MutationValidationError';
  }
}

// Validate update response contains all requested IDs
export function validateUpdateResponse(
  operation: string,
  requestedIds: string[],
  returnedTransactions: Array<{id: string}>,
): void;

// Validate create response count
export function validateCreateResponse(
  operation: string,
  requestedCount: number,
  returnedCount: number,
  duplicateCount: number,
): void;

// Validate single-entity response
export function validateSingleEntityResponse(
  operation: string,
  expectedId: string,
  returnedId: string,
): void;

// Validate created account matches request
export function validateCreatedAccount(
  requestedName: string,
  requestedType: string,
  returnedAccount: {name: string; type: string},
): void;
```

### 2. Add validation to each mutation method

#### `updateTransactions` (ynab-client.ts ~line 1211)

- Extract all IDs from the input `updates` array
- After API call, extract all IDs from `response.data.transactions`
- Validate that all requested IDs are present in response

#### `createTransactions` (ynab-client.ts ~line 1598)

- Count input transactions
- After API call, count `response.data.transactions` + `duplicate_import_ids`
- Validate total matches (created + duplicates should equal requested)

#### `deleteTransaction` (ynab-client.ts ~line 1654)

- After API call, validate `response.data.transaction.id === transactionId`

#### `createAccount` (ynab-client.ts ~line 1698)

- After API call, validate:
  - `response.data.account.name === name`
  - `response.data.account.type === type`

#### `updateCategoryBudget` (ynab-client.ts ~line 1749)

- After API call, validate `response.data.category.id === categoryId`

### 3. Error behavior

When validation fails:

- Throw a `MutationValidationError` with descriptive message
- Include expected vs actual values for debugging
- The error will propagate through the tool layer and be returned to the user

## Testing Strategy

- Add unit tests for validation helper functions
- Add integration tests that mock unexpected API responses
- Test that validation errors are properly formatted and returned

## Status

- [x] Create mutation-validation.ts with helper functions
- [x] Add validation to updateTransactions
- [x] Add validation to createTransactions
- [x] Add validation to deleteTransaction
- [x] Add validation to createAccount
- [x] Add validation to updateCategoryBudget
- [x] Add tests for validation helpers
- [x] Run signal and fix any issues

## Implementation Summary

**Files Created:**

- `src/mutation-validation.ts` - Validation helpers and `MutationValidationError` class
- `src/mutation-validation.test.ts` - Unit tests for all validation functions (20 tests)

**Files Modified:**

- `src/ynab-client.ts` - Added validation calls to 5 mutation methods
- `src/mocks/handlers.ts` - Updated MSW handlers to return responses matching requests (for test compatibility)

**Validation Added:**

| Method                 | Validation                                   |
| ---------------------- | -------------------------------------------- |
| `updateTransactions`   | All requested IDs present in response        |
| `createTransactions`   | Created + duplicates = requested count       |
| `deleteTransaction`    | Returned transaction ID matches requested ID |
| `createAccount`        | Returned account name and type match request |
| `updateCategoryBudget` | Returned category ID matches requested ID    |

All 202 tests pass. Signal checks (TypeScript, ESLint, Prettier) pass.
