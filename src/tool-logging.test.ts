/**
 * Tests for tool logging wrapper module.
 *
 * Tests the wrapToolWithLogging function and createLoggingToolAdder.
 */

import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';

import {wrapToolWithLogging} from './tool-logging.js';

// ============================================================================
// Mock Context
// ============================================================================

function createMockContext() {
  return {
    client: {
      version: '1.0.0' as unknown,
    },
    log: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    reportProgress: vi.fn().mockResolvedValue(undefined),
    requestId: 'test-request-123',
    session: undefined as unknown,
    sessionId: 'test-session-456',
    streamContent: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// wrapToolWithLogging Tests
// ============================================================================

describe('wrapToolWithLogging', () => {
  it('preserves tool name', () => {
    const tool = {
      execute: vi.fn().mockResolvedValue('result'),
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);

    expect(wrapped.name).toBe('test_tool');
  });

  it('preserves tool description', () => {
    const tool = {
      description: 'A test tool',
      execute: vi.fn().mockResolvedValue('result'),
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);

    expect(wrapped.description).toBe('A test tool');
  });

  it('preserves tool parameters', () => {
    const params = z.object({foo: z.string()});
    const tool = {
      execute: vi.fn().mockResolvedValue('result'),
      name: 'test_tool',
      parameters: params,
    };

    const wrapped = wrapToolWithLogging(tool);

    expect(wrapped.parameters).toBe(params);
  });

  it('preserves tool annotations', () => {
    const tool = {
      annotations: {
        readOnlyHint: true,
        title: 'Test Tool',
      },
      execute: vi.fn().mockResolvedValue('result'),
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);

    expect(wrapped.annotations).toEqual({
      readOnlyHint: true,
      title: 'Test Tool',
    });
  });

  it('calls original execute function', async () => {
    const originalExecute = vi.fn().mockResolvedValue('original result');
    const tool = {
      execute: originalExecute,
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const context = createMockContext();

    const result = await wrapped.execute({arg: 'value'}, context);

    expect(originalExecute).toHaveBeenCalledWith({arg: 'value'}, context);
    expect(result).toBe('original result');
  });

  it('passes through errors from original execute', async () => {
    const testError = new Error('Test error');
    const originalExecute = vi.fn().mockRejectedValue(testError);
    const tool = {
      execute: originalExecute,
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const context = createMockContext();

    await expect(wrapped.execute({}, context)).rejects.toThrow('Test error');
  });

  it('handles async execute functions', async () => {
    const originalExecute = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'async result';
    });
    const tool = {
      execute: originalExecute,
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const context = createMockContext();

    const result = await wrapped.execute({}, context);

    expect(result).toBe('async result');
  });

  it('preserves timeoutMs', () => {
    const tool = {
      execute: vi.fn().mockResolvedValue('result'),
      name: 'test_tool',
      timeoutMs: 5000,
    };

    const wrapped = wrapToolWithLogging(tool);

    expect(wrapped.timeoutMs).toBe(5000);
  });
});

// ============================================================================
// Context Handling Tests
// ============================================================================

describe('context handling', () => {
  it('passes context to original execute', async () => {
    const originalExecute = vi.fn().mockResolvedValue('result');
    const tool = {
      execute: originalExecute,
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const context = createMockContext();

    await wrapped.execute({foo: 'bar'}, context);

    expect(originalExecute).toHaveBeenCalledTimes(1);
    expect(originalExecute).toHaveBeenCalledWith(
      {foo: 'bar'},
      expect.objectContaining({
        requestId: 'test-request-123',
        sessionId: 'test-session-456',
      }),
    );
  });

  it('handles undefined sessionId', async () => {
    const originalExecute = vi.fn().mockResolvedValue('result');
    const tool = {
      execute: originalExecute,
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const context = {
      ...createMockContext(),
      sessionId: undefined,
    };

    // Should not throw
    await wrapped.execute({}, context);

    expect(originalExecute).toHaveBeenCalled();
  });

  it('handles undefined requestId', async () => {
    const originalExecute = vi.fn().mockResolvedValue('result');
    const tool = {
      execute: originalExecute,
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const context = {
      ...createMockContext(),
      requestId: undefined,
    };

    // Should not throw
    await wrapped.execute({}, context);

    expect(originalExecute).toHaveBeenCalled();
  });
});

// ============================================================================
// Return Value Tests
// ============================================================================

describe('return values', () => {
  it('returns string result', async () => {
    const tool = {
      execute: vi.fn().mockResolvedValue('string result'),
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const result = await wrapped.execute({}, createMockContext());

    expect(result).toBe('string result');
  });

  it('returns object result', async () => {
    const resultObj = {data: [1, 2, 3], status: 'ok'};
    const tool = {
      execute: vi.fn().mockResolvedValue(resultObj),
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const result = await wrapped.execute({}, createMockContext());

    expect(result).toEqual(resultObj);
  });

  it('returns null result', async () => {
    const tool = {
      execute: vi.fn().mockResolvedValue(null),
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const result = await wrapped.execute({}, createMockContext());

    expect(result).toBeNull();
  });

  it('returns undefined result', async () => {
    const tool = {
      execute: vi.fn().mockResolvedValue(undefined),
      name: 'test_tool',
    };

    const wrapped = wrapToolWithLogging(tool);
    const result = await wrapped.execute({}, createMockContext());

    expect(result).toBeUndefined();
  });
});
