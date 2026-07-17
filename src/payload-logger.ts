/**
 * Payload logger for comprehensive request/response logging.
 *
 * Saves MCP tool calls and YNAB API requests/responses to disk for debugging.
 * Organized by session, with automatic 30-day purging (disabled by default).
 */

import {randomUUID} from 'node:crypto';
import {mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

import {fileLogger} from './logger.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Check if payload logging is enabled.
 * Defaults to true during alpha development.
 */
export function isPayloadLoggingEnabled(): boolean {
  const value = process.env['YNAB_PAYLOAD_LOGGING'];
  // Default to true, only disable if explicitly set to 'false' or '0'
  return value !== 'false' && value !== '0';
}

/**
 * Check if auto-purging of old payloads is enabled.
 * Defaults to false (keep payloads indefinitely).
 */
export function isAutoPurgeEnabled(): boolean {
  const value = process.env['YNAB_PAYLOAD_AUTO_PURGE'];
  return value === 'true' || value === '1';
}

/**
 * Get the number of days to retain payload logs before purging.
 * Defaults to 30 days.
 */
export function getPurgeRetentionDays(): number {
  const value = process.env['YNAB_PAYLOAD_RETENTION_DAYS'];
  if (value !== undefined) {
    const days = parseInt(value, 10);
    if (!isNaN(days) && days > 0) {
      return days;
    }
  }
  return 30;
}

/**
 * Get the payload directory path.
 * Can be overridden via YNAB_PAYLOAD_DIR env var.
 */
export function getPayloadDir(): string {
  return (
    process.env['YNAB_PAYLOAD_DIR'] ??
    join(homedir(), '.config', 'ynab-mcp-deluxe', 'payloads')
  );
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Server session ID - generated once at startup.
 * Used as fallback when MCP session ID is not available.
 */
const serverSessionId = randomUUID().slice(0, 8);

/**
 * Current active session ID.
 * Updated when MCP provides a session ID, falls back to server session.
 */
let currentSessionId: string = serverSessionId;

/**
 * Sequence counter for ordering payloads within a session.
 * Resets when session changes.
 */
let sequenceCounter = 0;

/**
 * Circuit breaker state for directory creation failures.
 * After MAX_DIR_FAILURES consecutive failures, logging is disabled for the session.
 */
const MAX_DIR_FAILURES = 3;
let dirFailureCount = 0;
let circuitBreakerTripped = false;

/**
 * Set the current session ID (called when MCP session ID is available).
 * Resets the sequence counter and circuit breaker on session change.
 */
export function setSessionId(sessionId: string | undefined): void {
  const newSessionId = sessionId ?? serverSessionId;
  if (newSessionId !== currentSessionId) {
    currentSessionId = newSessionId;
    sequenceCounter = 0; // Reset sequence for new session
    // Reset circuit breaker for new session - new session may have different permissions
    dirFailureCount = 0;
    circuitBreakerTripped = false;
    fileLogger.debug('Payload logger session changed', {
      sessionId: currentSessionId,
    });
  }
}

/**
 * Reset the circuit breaker state (for testing).
 */
export function resetCircuitBreaker(): void {
  dirFailureCount = 0;
  circuitBreakerTripped = false;
}

/**
 * Check if the circuit breaker is tripped (for testing).
 */
export function isCircuitBreakerTripped(): boolean {
  return circuitBreakerTripped;
}

/**
 * Get the current session ID.
 */
export function getSessionId(): string {
  return currentSessionId;
}

/**
 * Get and increment the sequence counter.
 */
function getNextSequence(): number {
  return ++sequenceCounter;
}

// ============================================================================
// File Writing
// ============================================================================

/**
 * Format timestamp for filenames (HH-mm-ss-SSS).
 */
function formatTimeForFilename(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}-${minutes}-${seconds}-${ms}`;
}

/**
 * Format date for directory name (YYYY-MM-DD).
 */
function formatDateForDir(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Get the session directory path for the current session.
 */
function getSessionDir(): string {
  const date = formatDateForDir(new Date());
  return join(getPayloadDir(), date, `session-${currentSessionId}`);
}

/**
 * Ensure the session directory exists.
 * Uses circuit breaker pattern - after MAX_DIR_FAILURES consecutive failures,
 * throws immediately without attempting mkdir.
 */
async function ensureSessionDir(): Promise<string> {
  // Check circuit breaker first
  if (circuitBreakerTripped) {
    throw new Error('Circuit breaker tripped: directory creation disabled');
  }

  const dir = getSessionDir();
  try {
    await mkdir(dir, {recursive: true});
    // Reset failure count on success
    dirFailureCount = 0;
    return dir;
  } catch (error) {
    dirFailureCount++;
    if (dirFailureCount >= MAX_DIR_FAILURES) {
      circuitBreakerTripped = true;
      fileLogger.error('Circuit breaker tripped: disabling payload logging', {
        consecutiveFailures: dirFailureCount,
        directory: dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

/**
 * Payload types
 */
export type PayloadLayer = 'mcp' | 'ynab';
export type PayloadDirection = 'req' | 'res';

/**
 * Generate a filename for a payload.
 *
 * Format: {sequence}_{time}_{layer}_{operation}_{direction}.json
 * Example: 000001_14-32-15-123_mcp_query_transactions_req.json
 *
 * Sequence supports up to 999,999 payloads per session, which is more than
 * adequate for debugging purposes (at 1 payload/second, this is ~11.5 days).
 */
function generatePayloadFilename(
  layer: PayloadLayer,
  operation: string,
  direction: PayloadDirection,
): string {
  const seq = getNextSequence().toString().padStart(6, '0');
  const time = formatTimeForFilename(new Date());
  // Sanitize operation name for filename (replace non-alphanumeric with underscore)
  const safeOperation = operation.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return `${seq}_${time}_${layer}_${safeOperation}_${direction}.json`;
}

/**
 * Write a payload to disk.
 * Returns the file path if successful, null if logging is disabled or failed.
 */
async function writePayload(
  layer: PayloadLayer,
  operation: string,
  direction: PayloadDirection,
  payload: unknown,
): Promise<string | null> {
  if (!isPayloadLoggingEnabled()) {
    return null;
  }

  try {
    const dir = await ensureSessionDir();
    const filename = generatePayloadFilename(layer, operation, direction);
    const filePath = join(dir, filename);

    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');

    fileLogger.debug('Payload written', {
      direction,
      filePath,
      layer,
      operation,
    });

    return filePath;
  } catch (error) {
    fileLogger.error('Failed to write payload', {
      direction,
      error: error instanceof Error ? error.message : String(error),
      layer,
      operation,
    });
    return null;
  }
}

// ============================================================================
// MCP Tool Logging
// ============================================================================

/**
 * MCP request payload structure
 */
interface McpRequestPayload {
  arguments: unknown;
  requestId?: string;
  sessionId: string;
  timestamp: string;
  tool: string;
}

/**
 * MCP response payload structure
 */
interface McpResponsePayload {
  durationMs: number;
  error?: {
    message: string;
    name?: string;
    stack?: string;
  };
  requestId?: string;
  response?: unknown;
  sessionId: string;
  success: boolean;
  timestamp: string;
  tool: string;
}

/**
 * Log an MCP tool request.
 */
export async function logMcpRequest(
  tool: string,
  args: unknown,
  requestId?: string,
): Promise<void> {
  const payload: McpRequestPayload = {
    arguments: args,
    requestId,
    sessionId: currentSessionId,
    timestamp: new Date().toISOString(),
    tool,
  };

  await writePayload('mcp', tool, 'req', payload);
}

/**
 * Log an MCP tool response.
 */
export async function logMcpResponse(
  tool: string,
  startTime: number,
  result: unknown,
  requestId?: string,
): Promise<void> {
  const durationMs = Math.round(performance.now() - startTime);

  const payload: McpResponsePayload = {
    durationMs,
    requestId,
    response: result,
    sessionId: currentSessionId,
    success: true,
    timestamp: new Date().toISOString(),
    tool,
  };

  await writePayload('mcp', tool, 'res', payload);
}

/**
 * Log an MCP tool error.
 */
export async function logMcpError(
  tool: string,
  startTime: number,
  error: unknown,
  requestId?: string,
): Promise<void> {
  const durationMs = Math.round(performance.now() - startTime);

  const payload: McpResponsePayload = {
    durationMs,
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    },
    requestId,
    sessionId: currentSessionId,
    success: false,
    timestamp: new Date().toISOString(),
    tool,
  };

  await writePayload('mcp', tool, 'res', payload);
}

// ============================================================================
// YNAB HTTP Logging
// ============================================================================

/**
 * YNAB HTTP request payload structure
 */
interface YnabRequestPayload {
  body?: unknown;
  headers: Record<string, string>;
  method: string;
  sessionId: string;
  timestamp: string;
  url: string;
}

/**
 * YNAB HTTP response payload structure
 */
interface YnabResponsePayload {
  body?: unknown;
  durationMs: number;
  headers: Record<string, string>;
  method: string;
  sessionId: string;
  status: number;
  statusText: string;
  timestamp: string;
  url: string;
}

/**
 * YNAB HTTP error payload structure
 */
interface YnabErrorPayload {
  durationMs: number;
  error: {
    message: string;
    name?: string;
  };
  method: string;
  sessionId: string;
  timestamp: string;
  url: string;
}

/**
 * Type alias for headers that can be passed to fetch.
 * Compatible with Headers, Record<string, string>, or [string, string][].
 */
type HeadersInput = Headers | Record<string, string> | [string, string][];

/**
 * Sanitize headers by removing sensitive information (auth tokens).
 */
function sanitizeHeaders(headers: HeadersInput): Record<string, string> {
  const result: Record<string, string> = {};
  const sensitiveKeys = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = value;
      }
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = value;
      }
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = String(value);
      }
    }
  }

  return result;
}

/**
 * Extract operation name from YNAB API URL.
 * Example: https://api.ynab.com/v1/budgets/xxx -> budgets
 */
function extractYnabOperation(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove version prefix and get first path segment
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    // Skip 'v1' or similar version prefix
    const operationParts = pathParts.filter((part) => {
      const match = /^v\d+$/.exec(part);
      return match === null;
    });
    // Take first two meaningful parts
    const joined = operationParts.slice(0, 2).join('_');
    return joined !== '' ? joined : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Log a YNAB HTTP request.
 */
export async function logYnabRequest(
  method: string,
  url: string,
  headers: HeadersInput,
  body?: unknown,
): Promise<void> {
  const operation = extractYnabOperation(url);

  const payload: YnabRequestPayload = {
    body,
    headers: sanitizeHeaders(headers),
    method,
    sessionId: currentSessionId,
    timestamp: new Date().toISOString(),
    url,
  };

  await writePayload('ynab', operation, 'req', payload);
}

/**
 * Log a YNAB HTTP response.
 */
export async function logYnabResponse(
  method: string,
  url: string,
  response: Response,
  body: unknown,
  startTime: number,
): Promise<void> {
  const operation = extractYnabOperation(url);
  const durationMs = Math.round(performance.now() - startTime);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const payload: YnabResponsePayload = {
    body,
    durationMs,
    headers: responseHeaders,
    method,
    sessionId: currentSessionId,
    status: response.status,
    statusText: response.statusText,
    timestamp: new Date().toISOString(),
    url,
  };

  await writePayload('ynab', operation, 'res', payload);
}

/**
 * Log a YNAB HTTP error.
 */
export async function logYnabError(
  method: string,
  url: string,
  error: unknown,
  startTime: number,
): Promise<void> {
  const operation = extractYnabOperation(url);
  const durationMs = Math.round(performance.now() - startTime);

  const payload: YnabErrorPayload = {
    durationMs,
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
    },
    method,
    sessionId: currentSessionId,
    timestamp: new Date().toISOString(),
    url,
  };

  await writePayload('ynab', operation, 'res', payload);
}

// ============================================================================
// Auto-Purge
// ============================================================================

/**
 * Purge payload directories older than the retention period.
 * Only runs if YNAB_PAYLOAD_AUTO_PURGE is enabled.
 *
 * @returns Number of directories purged
 */
export async function purgeOldPayloads(): Promise<number> {
  if (!isAutoPurgeEnabled()) {
    fileLogger.debug('Auto-purge is disabled, skipping');
    return 0;
  }

  const retentionDays = getPurgeRetentionDays();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const payloadDir = getPayloadDir();
  let purgedCount = 0;

  try {
    const entries = await readdir(payloadDir, {withFileTypes: true});

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check if directory name is a date (YYYY-MM-DD)
      const dateMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(entry.name);
      if (dateMatch === null) continue;

      const dateString = dateMatch[1];
      if (dateString === undefined) continue;

      const dirDate = new Date(dateString);
      if (isNaN(dirDate.getTime())) continue;

      if (dirDate < cutoffDate) {
        const dirPath = join(payloadDir, entry.name);
        await rm(dirPath, {force: true, recursive: true});
        purgedCount++;
        fileLogger.info('Purged old payload directory', {
          age: Math.floor(
            (Date.now() - dirDate.getTime()) / (1000 * 60 * 60 * 24),
          ),
          directory: entry.name,
        });
      }
    }
  } catch (error) {
    // Directory might not exist yet, which is fine
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      fileLogger.error('Failed to purge old payloads', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (purgedCount > 0) {
    fileLogger.info('Payload purge completed', {
      purgedDirectories: purgedCount,
      retentionDays,
    });
  }

  return purgedCount;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the payload logger.
 * Call this at server startup.
 */
export async function initPayloadLogger(): Promise<void> {
  if (!isPayloadLoggingEnabled()) {
    fileLogger.info('Payload logging is disabled');
    return;
  }

  fileLogger.info('Payload logging initialized', {
    autoPurge: isAutoPurgeEnabled(),
    payloadDir: getPayloadDir(),
    retentionDays: getPurgeRetentionDays(),
    sessionId: currentSessionId,
  });

  // Run purge check on startup (only if enabled)
  await purgeOldPayloads();
}
