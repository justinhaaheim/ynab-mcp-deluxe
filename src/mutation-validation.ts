/**
 * Mutation response validation utilities.
 *
 * These helpers verify that API responses from mutation operations
 * match what was requested, providing early detection of issues like:
 * - Wrong entity updated due to ID confusion
 * - Partial failures where some items weren't processed
 * - API returning unexpected responses
 */

/**
 * Error thrown when a mutation response doesn't match expectations.
 */
export class MutationValidationError extends Error {
  readonly operation: string;
  readonly expected: unknown;
  readonly actual: unknown;

  constructor(
    operation: string,
    expected: unknown,
    actual: unknown,
    message: string,
  ) {
    super(`${operation}: ${message}`);
    this.name = 'MutationValidationError';
    this.operation = operation;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Validate that all requested IDs are present in the update response.
 *
 * @param operation - Name of the operation (for error messages)
 * @param requestedIds - IDs that were sent for update
 * @param returnedEntities - Entities returned from the API
 * @throws MutationValidationError if any requested ID is missing from response
 */
export function validateUpdateResponse(
  operation: string,
  requestedIds: string[],
  returnedEntities: {id: string}[],
): void {
  const returnedIds = new Set(returnedEntities.map((e) => e.id));
  const missingIds = requestedIds.filter((id) => !returnedIds.has(id));

  if (missingIds.length > 0) {
    throw new MutationValidationError(
      operation,
      requestedIds,
      Array.from(returnedIds),
      `Response missing ${missingIds.length} of ${requestedIds.length} requested IDs: ${missingIds.join(', ')}`,
    );
  }
}

/**
 * Validate that the create response accounts for all requested items.
 *
 * For batch creates, some items may be duplicates (based on import_id).
 * The total of created + duplicates should equal the requested count.
 *
 * @param operation - Name of the operation (for error messages)
 * @param requestedCount - Number of items sent for creation
 * @param createdCount - Number of items actually created
 * @param duplicateCount - Number of items identified as duplicates
 * @throws MutationValidationError if counts don't add up
 */
export function validateCreateResponse(
  operation: string,
  requestedCount: number,
  createdCount: number,
  duplicateCount: number,
): void {
  const totalAccountedFor = createdCount + duplicateCount;

  if (totalAccountedFor !== requestedCount) {
    throw new MutationValidationError(
      operation,
      requestedCount,
      {
        created: createdCount,
        duplicates: duplicateCount,
        total: totalAccountedFor,
      },
      `Expected ${requestedCount} items accounted for, but got ${createdCount} created + ${duplicateCount} duplicates = ${totalAccountedFor}`,
    );
  }
}

/**
 * Validate that a single-entity response matches the requested ID.
 *
 * @param operation - Name of the operation (for error messages)
 * @param expectedId - The ID that was requested
 * @param returnedId - The ID in the response
 * @throws MutationValidationError if IDs don't match
 */
export function validateSingleEntityResponse(
  operation: string,
  expectedId: string,
  returnedId: string,
): void {
  if (expectedId !== returnedId) {
    throw new MutationValidationError(
      operation,
      expectedId,
      returnedId,
      `Expected ID "${expectedId}" but got "${returnedId}"`,
    );
  }
}

/**
 * Validate that a created account matches the requested properties.
 *
 * @param operation - Name of the operation (for error messages)
 * @param requestedName - The name that was requested
 * @param requestedType - The type that was requested
 * @param returnedAccount - The account returned from the API
 * @throws MutationValidationError if name or type doesn't match
 */
export function validateCreatedAccount(
  operation: string,
  requestedName: string,
  requestedType: string,
  returnedAccount: {name: string; type: string},
): void {
  const mismatches: string[] = [];

  if (requestedName !== returnedAccount.name) {
    mismatches.push(
      `name: expected "${requestedName}", got "${returnedAccount.name}"`,
    );
  }

  if (requestedType !== returnedAccount.type) {
    mismatches.push(
      `type: expected "${requestedType}", got "${returnedAccount.type}"`,
    );
  }

  if (mismatches.length > 0) {
    throw new MutationValidationError(
      operation,
      {name: requestedName, type: requestedType},
      {name: returnedAccount.name, type: returnedAccount.type},
      `Account mismatch: ${mismatches.join('; ')}`,
    );
  }
}
