/**
 * Tests for payload logger module.
 *
 * Tests configuration, session management, circuit breaker,
 * and filename generation. File I/O is tested via integration.
 */

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {z} from 'zod';

import {
  getPayloadDir,
  getPurgeRetentionDays,
  getSessionId,
  isAutoPurgeEnabled,
  isCircuitBreakerTripped,
  isPayloadLoggingEnabled,
  logMcpRequest,
  logMcpResponse,
  purgeOldPayloads,
  resetCircuitBreaker,
  setSessionId,
} from './payload-logger.js';

// ============================================================================
// Helpers for integration tests
// ============================================================================

/** Find the first subdirectory in a directory */
async function findFirstSubdir(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir, {withFileTypes: true});
  return entries.find((e) => e.isDirectory())?.name;
}

/** Recursively find all .json files under a directory */
async function findAllPayloadFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findAllPayloadFiles(fullPath)));
    } else if (entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Schema for parsed MCP request payloads */
const McpRequestPayloadSchema = z.object({
  arguments: z.unknown(),
  requestId: z.string().optional(),
  sessionId: z.string(),
  timestamp: z.string(),
  tool: z.string(),
});

/** Schema for parsed MCP response payloads */
const McpResponsePayloadSchema = z.object({
  durationMs: z.number(),
  response: z.unknown().optional(),
  success: z.boolean(),
  tool: z.string(),
});

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

// ============================================================================
// Integration Tests - File I/O
// ============================================================================

describe('file I/O integration', () => {
  let tempDir: string;
  let originalPayloadDir: string | undefined;
  let originalPayloadLogging: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ynab-payload-test-'));
    originalPayloadDir = process.env['YNAB_PAYLOAD_DIR'];
    originalPayloadLogging = process.env['YNAB_PAYLOAD_LOGGING'];
    process.env['YNAB_PAYLOAD_DIR'] = tempDir;
    process.env['YNAB_PAYLOAD_LOGGING'] = 'true';
    // Use a unique session to avoid collisions and reset sequence
    setSessionId('integration-test-' + Date.now());
    resetCircuitBreaker();
  });

  afterEach(async () => {
    if (originalPayloadDir === undefined) {
      delete process.env['YNAB_PAYLOAD_DIR'];
    } else {
      process.env['YNAB_PAYLOAD_DIR'] = originalPayloadDir;
    }
    if (originalPayloadLogging === undefined) {
      delete process.env['YNAB_PAYLOAD_LOGGING'];
    } else {
      process.env['YNAB_PAYLOAD_LOGGING'] = originalPayloadLogging;
    }
    setSessionId(undefined);
    resetCircuitBreaker();
    // Clean up temp directory
    await rm(tempDir, {force: true, recursive: true});
  });

  it('logMcpRequest writes a JSON file to disk', async () => {
    await logMcpRequest('test_tool', {foo: 'bar'}, 'req-123');

    // Find the written file
    const dateDir = await findFirstSubdir(tempDir);
    expect(dateDir).toBeDefined();

    const sessionDir = await findFirstSubdir(join(tempDir, dateDir ?? ''));
    expect(sessionDir).toBeDefined();

    const sessionPath = join(tempDir, dateDir ?? '', sessionDir ?? '');
    const files = await readdir(sessionPath);
    expect(files.length).toBe(1);

    const firstFile = files[0];
    expect(firstFile).toBeDefined();
    expect(firstFile).toMatch(/mcp_test_tool_req\.json$/);

    const raw = await readFile(join(sessionPath, firstFile ?? ''), 'utf-8');
    const content = McpRequestPayloadSchema.parse(JSON.parse(raw));
    expect(content.tool).toBe('test_tool');
    expect(content.arguments).toEqual({foo: 'bar'});
    expect(content.requestId).toBe('req-123');
    expect(content.sessionId).toBeDefined();
    expect(content.timestamp).toBeDefined();
  });

  it('logMcpResponse writes response payload to disk', async () => {
    const startTime = performance.now();
    await logMcpResponse('test_tool', startTime, {result: 'ok'}, 'req-456');

    const files = await findAllPayloadFiles(tempDir);
    expect(files.length).toBe(1);

    const firstFile = files[0];
    expect(firstFile).toBeDefined();

    const raw = await readFile(firstFile ?? '', 'utf-8');
    const content = McpResponsePayloadSchema.parse(JSON.parse(raw));
    expect(content.tool).toBe('test_tool');
    expect(content.success).toBe(true);
    expect(content.response).toEqual({result: 'ok'});
    expect(content.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('writes multiple payloads with incrementing sequence numbers', async () => {
    await logMcpRequest('tool_a', {}, 'req-1');
    await logMcpRequest('tool_b', {}, 'req-2');
    await logMcpRequest('tool_c', {}, 'req-3');

    const files = await findAllPayloadFiles(tempDir);
    expect(files.length).toBe(3);

    // Filenames should have incrementing sequence prefixes
    const filenames = files
      .map((f) => {
        const parts = f.split('/');
        return parts[parts.length - 1] ?? '';
      })
      .sort();
    expect(filenames[0]).toMatch(/^000001_/);
    expect(filenames[1]).toMatch(/^000002_/);
    expect(filenames[2]).toMatch(/^000003_/);
  });

  it('does not write files when logging is disabled', async () => {
    process.env['YNAB_PAYLOAD_LOGGING'] = 'false';

    await logMcpRequest('test_tool', {foo: 'bar'});

    const entries = await readdir(tempDir);
    expect(entries.length).toBe(0);
  });
});

// ============================================================================
// Integration Tests - Purge
// ============================================================================

describe('purgeOldPayloads integration', () => {
  let tempDir: string;
  let originalPayloadDir: string | undefined;
  let originalAutoPurge: string | undefined;
  let originalRetention: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ynab-purge-test-'));
    originalPayloadDir = process.env['YNAB_PAYLOAD_DIR'];
    originalAutoPurge = process.env['YNAB_PAYLOAD_AUTO_PURGE'];
    originalRetention = process.env['YNAB_PAYLOAD_RETENTION_DAYS'];
    process.env['YNAB_PAYLOAD_DIR'] = tempDir;
  });

  afterEach(async () => {
    if (originalPayloadDir === undefined) {
      delete process.env['YNAB_PAYLOAD_DIR'];
    } else {
      process.env['YNAB_PAYLOAD_DIR'] = originalPayloadDir;
    }
    if (originalAutoPurge === undefined) {
      delete process.env['YNAB_PAYLOAD_AUTO_PURGE'];
    } else {
      process.env['YNAB_PAYLOAD_AUTO_PURGE'] = originalAutoPurge;
    }
    if (originalRetention === undefined) {
      delete process.env['YNAB_PAYLOAD_RETENTION_DAYS'];
    } else {
      process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = originalRetention;
    }
    await rm(tempDir, {force: true, recursive: true});
  });

  it('deletes directories older than retention period', async () => {
    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = 'true';
    process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = '7';

    // Create an old date directory (30 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    const oldDirName = oldDate.toISOString().slice(0, 10);
    const oldDirPath = join(tempDir, oldDirName);
    await mkdir(oldDirPath, {recursive: true});
    await writeFile(join(oldDirPath, 'test.json'), '{}');

    // Create a recent date directory (2 days ago)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 2);
    const recentDirName = recentDate.toISOString().slice(0, 10);
    const recentDirPath = join(tempDir, recentDirName);
    await mkdir(recentDirPath, {recursive: true});
    await writeFile(join(recentDirPath, 'test.json'), '{}');

    const purged = await purgeOldPayloads();

    expect(purged).toBe(1);

    const remaining = await readdir(tempDir);
    expect(remaining).toContain(recentDirName);
    expect(remaining).not.toContain(oldDirName);
  });

  it('does not purge when auto-purge is disabled', async () => {
    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = 'false';

    // Create an old directory
    const oldDirPath = join(tempDir, '2020-01-01');
    await mkdir(oldDirPath, {recursive: true});

    const purged = await purgeOldPayloads();
    expect(purged).toBe(0);

    // Directory should still exist
    const remaining = await readdir(tempDir);
    expect(remaining).toContain('2020-01-01');
  });

  it('handles non-existent payload directory gracefully', async () => {
    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = 'true';
    process.env['YNAB_PAYLOAD_DIR'] = join(tempDir, 'does-not-exist');

    // Should not throw
    const purged = await purgeOldPayloads();
    expect(purged).toBe(0);
  });

  it('ignores non-date directories', async () => {
    process.env['YNAB_PAYLOAD_AUTO_PURGE'] = 'true';
    process.env['YNAB_PAYLOAD_RETENTION_DAYS'] = '1';

    // Create a non-date directory
    await mkdir(join(tempDir, 'not-a-date'), {recursive: true});
    // Create a regular file
    await writeFile(join(tempDir, 'stray-file.txt'), 'hello');

    const purged = await purgeOldPayloads();
    expect(purged).toBe(0);

    // Both should still exist
    const remaining = await readdir(tempDir);
    expect(remaining).toContain('not-a-date');
    expect(remaining).toContain('stray-file.txt');
  });
});
