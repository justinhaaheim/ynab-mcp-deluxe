import {describe, expect, it} from 'vitest';

import {
  MutationValidationError,
  validateCreatedAccount,
  validateCreateResponse,
  validateSingleEntityResponse,
  validateUpdateResponse,
} from './mutation-validation.js';

describe('MutationValidationError', () => {
  it('should include operation name in message', () => {
    const error = new MutationValidationError(
      'test_operation',
      'expected',
      'actual',
      'test message',
    );

    expect(error.message).toBe('test_operation: test message');
    expect(error.name).toBe('MutationValidationError');
    expect(error.operation).toBe('test_operation');
    expect(error.expected).toBe('expected');
    expect(error.actual).toBe('actual');
  });
});

describe('validateUpdateResponse', () => {
  it('should pass when all requested IDs are in response', () => {
    const requestedIds = ['id1', 'id2', 'id3'];
    const returnedEntities = [{id: 'id1'}, {id: 'id2'}, {id: 'id3'}];

    expect(() =>
      validateUpdateResponse(
        'update_transactions',
        requestedIds,
        returnedEntities,
      ),
    ).not.toThrow();
  });

  it('should pass when response contains extra IDs', () => {
    const requestedIds = ['id1', 'id2'];
    const returnedEntities = [{id: 'id1'}, {id: 'id2'}, {id: 'id3'}];

    expect(() =>
      validateUpdateResponse(
        'update_transactions',
        requestedIds,
        returnedEntities,
      ),
    ).not.toThrow();
  });

  it('should throw when some requested IDs are missing', () => {
    const requestedIds = ['id1', 'id2', 'id3'];
    const returnedEntities = [{id: 'id1'}];

    expect(() =>
      validateUpdateResponse(
        'update_transactions',
        requestedIds,
        returnedEntities,
      ),
    ).toThrow(MutationValidationError);
  });

  it('should include missing IDs in error message', () => {
    const requestedIds = ['id1', 'id2', 'id3'];
    const returnedEntities = [{id: 'id1'}];

    try {
      validateUpdateResponse(
        'update_transactions',
        requestedIds,
        returnedEntities,
      );
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MutationValidationError);
      const mutationError = error as MutationValidationError;
      expect(mutationError.message).toContain('id2');
      expect(mutationError.message).toContain('id3');
      expect(mutationError.message).toContain('2 of 3');
    }
  });

  it('should handle empty arrays', () => {
    expect(() =>
      validateUpdateResponse('update_transactions', [], []),
    ).not.toThrow();
  });
});

describe('validateCreateResponse', () => {
  it('should pass when all items are created', () => {
    expect(() =>
      validateCreateResponse('create_transactions', 3, 3, 0),
    ).not.toThrow();
  });

  it('should pass when some items are duplicates', () => {
    expect(() =>
      validateCreateResponse('create_transactions', 5, 3, 2),
    ).not.toThrow();
  });

  it('should pass when all items are duplicates', () => {
    expect(() =>
      validateCreateResponse('create_transactions', 3, 0, 3),
    ).not.toThrow();
  });

  it('should throw when counts do not add up', () => {
    expect(() =>
      validateCreateResponse('create_transactions', 5, 2, 1),
    ).toThrow(MutationValidationError);
  });

  it('should include counts in error message', () => {
    try {
      validateCreateResponse('create_transactions', 5, 2, 1);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MutationValidationError);
      const mutationError = error as MutationValidationError;
      expect(mutationError.message).toContain('5');
      expect(mutationError.message).toContain('2 created');
      expect(mutationError.message).toContain('1 duplicates');
      expect(mutationError.expected).toBe(5);
    }
  });

  it('should handle zero items', () => {
    expect(() =>
      validateCreateResponse('create_transactions', 0, 0, 0),
    ).not.toThrow();
  });
});

describe('validateSingleEntityResponse', () => {
  it('should pass when IDs match', () => {
    expect(() =>
      validateSingleEntityResponse('delete_transaction', 'abc123', 'abc123'),
    ).not.toThrow();
  });

  it('should throw when IDs do not match', () => {
    expect(() =>
      validateSingleEntityResponse('delete_transaction', 'abc123', 'def456'),
    ).toThrow(MutationValidationError);
  });

  it('should include both IDs in error message', () => {
    try {
      validateSingleEntityResponse('delete_transaction', 'abc123', 'def456');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MutationValidationError);
      const mutationError = error as MutationValidationError;
      expect(mutationError.message).toContain('abc123');
      expect(mutationError.message).toContain('def456');
      expect(mutationError.expected).toBe('abc123');
      expect(mutationError.actual).toBe('def456');
    }
  });
});

describe('validateCreatedAccount', () => {
  it('should pass when name and type match', () => {
    expect(() =>
      validateCreatedAccount('create_account', 'Checking', 'checking', {
        name: 'Checking',
        type: 'checking',
      }),
    ).not.toThrow();
  });

  it('should throw when name does not match', () => {
    expect(() =>
      validateCreatedAccount('create_account', 'Checking', 'checking', {
        name: 'Savings',
        type: 'checking',
      }),
    ).toThrow(MutationValidationError);
  });

  it('should throw when type does not match', () => {
    expect(() =>
      validateCreatedAccount('create_account', 'Checking', 'checking', {
        name: 'Checking',
        type: 'savings',
      }),
    ).toThrow(MutationValidationError);
  });

  it('should include mismatches in error message', () => {
    try {
      validateCreatedAccount('create_account', 'Checking', 'checking', {
        name: 'Savings',
        type: 'creditCard',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MutationValidationError);
      const mutationError = error as MutationValidationError;
      expect(mutationError.message).toContain('name');
      expect(mutationError.message).toContain('type');
      expect(mutationError.message).toContain('Checking');
      expect(mutationError.message).toContain('Savings');
    }
  });

  it('should report only name mismatch when type matches', () => {
    try {
      validateCreatedAccount('create_account', 'Checking', 'checking', {
        name: 'Savings',
        type: 'checking',
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MutationValidationError);
      const mutationError = error as MutationValidationError;
      expect(mutationError.message).toContain('name');
      expect(mutationError.message).not.toContain('type:');
    }
  });
});
