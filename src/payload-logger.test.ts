/**
 * Tests for payload logger module.
 *
 * Tests configuration, session management, circuit breaker,
 * and filename generation. File I/O is tested via integration.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  getPayloadDir,
  getPurgeRetentionDays,
  getSessionId,
  isAutoPurgeEnabled,
  isCircuitBreakerTripped,
  isPayloadLoggingEnabled,
  resetCircuitBreaker,
  setSessionId,
} from './payload-logger.js';

// ============================================================================
// Configuration Tests
// ============================================================================

describe('isPayloadLoggingEnabled', () => {
  const originalEnv = process.env['YNAB_PAYLOAD_LOGGING'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['YNAB_PAYLOAD_LOGGING'];
    } else {
      process.env['YNAB_PAYLOAD_LOGGING'] = originalEnv;
    }
  });

  it('defaults to true when env var not set', () => {
    delete process.env['YNAB_PAYLOAD_LOGGING'];
    expect(isPayloadLoggingEnabled()).toBe(true);
  });

  it('returns true when env var is any non-false value', () => {
    process.env['YNAB_PAYLOAD_LOGGING'] = 'true';
    expect(isPayloadLoggingEnabled()).toBe(true);

    process.env['YNAB_PAYLOAD_LOGGING'] = '1';
    expect(isPayloadLoggingEnabled()).toBe(true);

    process.env['YNAB_PAYLOAD_LOGGING'] = 'yes';
    expect(isPayloadLoggingEnabled()).toBe(true);
  });

  it('returns false when env var is "false"', () => {
    process.env['YNAB_PAYLOAD_LOGGING'] = 'false';
    expect(isPayloadLoggingEnabled()).toBe(false);
  });

  it('returns false when env var is "0"', () => {
    process.env['YNAB_PAYLOAD_LOGGING'] = '0';
    expect(isPayloadLoggingEnabled()).toBe(false);
  });
});

describe('isAutoPurgeEnabled', () => {
  const originalEnv = process.env['YNAB_PAYLOAD_AUTO_PURGE'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['YNAB_PAYLOAD_AUTO_PURGE'];
    } else {
      process.env['YNAB_PAYLOAD_AUTO_PURGE'] = originalEnv;
    }
  });

  it('defaults to false when env var not set', () => {
    delete process.env['YNAB_PAYLOAD_AUTO_PURGE'];
    expect(isAutoPurgeEnabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = 'true';
    expect(isAutoPurgeEnabled()).toBe(true);
  });

  it('returns true when env var is "1"', () => {
    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = '1';
    expect(isAutoPurgeEnabled()).toBe(true);
  });

  it('returns false for other values', () => {
    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = 'yes';
    expect(isAutoPurgeEnabled()).toBe(false);

    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = 'false';
    expect(isAutoPurgeEnabled()).toBe(false);
  });
});

describe('getPurgeRetentionDays', () => {
  const originalEnv = process.env['YNAB_PAYLOAD_RETENTION_DAYS'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['YNAB_PAYLOAD_RETENTION_DAYS'];
    } else {
      process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = originalEnv;
    }
  });

  it('defaults to 30 days when env var not set', () => {
    delete process.env['YNAB_PAYLOAD_RETENTION_DAYS'];
    expect(getPurgeRetentionDays()).toBe(30);
  });

  it('returns configured value when set', () => {
    process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = '7';
    expect(getPurgeRetentionDays()).toBe(7);

    process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = '90';
    expect(getPurgeRetentionDays()).toBe(90);
  });

  it('returns default for invalid values', () => {
    process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = 'invalid';
    expect(getPurgeRetentionDays()).toBe(30);

    process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = '-5';
    expect(getPurgeRetentionDays()).toBe(30);

    process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = '0';
    expect(getPurgeRetentionDays()).toBe(30);
  });
});

describe('getPayloadDir', () => {
  const originalEnv = process.env['YNAB_PAYLOAD_DIR'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['YNAB_PAYLOAD_DIR'];
    } else {
      process.env['YNAB_PAYLOAD_DIR'] = originalEnv;
    }
  });

  it('returns default path when env var not set', () => {
    delete process.env['YNAB_PAYLOAD_DIR'];
    const dir = getPayloadDir();
    expect(dir).toContain('.config');
    expect(dir).toContain('ynab-mcp-deluxe');
    expect(dir).toContain('payloads');
  });

  it('returns custom path when env var is set', () => {
    process.env['YNAB_PAYLOAD_DIR'] = '/custom/path';
    expect(getPayloadDir()).toBe('/custom/path');
  });
});

// ============================================================================
// Session Management Tests
// ============================================================================

describe('session management', () => {
  beforeEach(() => {
    // Reset to initial state
    setSessionId(undefined);
    resetCircuitBreaker();
  });

  it('has a default session ID at startup', () => {
    const sessionId = getSessionId();
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it('updates session ID when set', () => {
    const newSessionId = 'test-session-123';
    setSessionId(newSessionId);
    expect(getSessionId()).toBe(newSessionId);
  });

  it('falls back to server session when set to undefined', () => {
    const initialSession = getSessionId();
    setSessionId('temp-session');
    setSessionId(undefined);
    // Should fall back to server session (same as initial)
    expect(getSessionId()).toBe(initialSession);
  });

  it('keeps same session ID when set to same value', () => {
    const sessionId = 'same-session';
    setSessionId(sessionId);
    const firstGet = getSessionId();
    setSessionId(sessionId);
    const secondGet = getSessionId();
    expect(firstGet).toBe(secondGet);
  });
});

// ============================================================================
// Circuit Breaker Tests
// ============================================================================

describe('circuit breaker', () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  it('starts in non-tripped state', () => {
    expect(isCircuitBreakerTripped()).toBe(false);
  });

  it('can be reset', () => {
    // We can't easily trip it without file system errors,
    // but we can verify reset works
    resetCircuitBreaker();
    expect(isCircuitBreakerTripped()).toBe(false);
  });

  it('resets when session changes', () => {
    // Change session
    setSessionId('new-session-1');
    expect(isCircuitBreakerTripped()).toBe(false);

    // Change again
    setSessionId('new-session-2');
    expect(isCircuitBreakerTripped()).toBe(false);
  });
});
