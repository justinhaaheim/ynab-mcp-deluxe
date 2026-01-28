/**
 * Pino-based logger for the MCP server.
 *
 * Writes JSON logs to ~/.config/ynab-mcp-deluxe/logs/ with date-based rotation.
 * Use `bun run logs` to tail the log file, optionally piping through pino-pretty.
 */

import {homedir} from 'node:os';
import {join} from 'node:path';
import pino from 'pino';

// Log directory: ~/.config/ynab-mcp-deluxe/logs/
const LOG_DIR = join(homedir(), '.config', 'ynab-mcp-deluxe', 'logs');

// Get log level from environment (default: debug)
const LOG_LEVEL = (process.env['LOG_LEVEL'] ?? 'debug').toLowerCase();

// Validate log level
const VALID_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const level = VALID_LEVELS.includes(LOG_LEVEL) ? LOG_LEVEL : 'debug';

/**
 * Format args into a message string.
 * First string arg becomes the message, rest are logged as data.
 */
function formatMessage(args: unknown[]): string {
  const firstString = args.find((arg) => typeof arg === 'string');
  if (typeof firstString === 'string') {
    return firstString;
  }
  return args.length > 0 ? JSON.stringify(args[0]) : '';
}

// Create pino transport for rolling file output
// Files are named: server.YYYY-MM-DD.N.log
const transport = pino.transport({
  options: {
    file: join(LOG_DIR, 'server'),
    frequency: 'daily',
    limit: {count: 7}, // Keep logs for 7 days
    mkdir: true,
  },
  target: 'pino-roll',
});

// Create pino logger with the transport
const pinoLogger = pino(
  {
    base: {
      pid: process.pid,
    },
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

/**
 * Logger that implements FastMCP's Logger interface.
 * Wraps pino to write structured JSON logs to a rotating file.
 */
export const logger = {
  debug(...args: unknown[]): void {
    pinoLogger.debug({args}, formatMessage(args));
  },
  error(...args: unknown[]): void {
    pinoLogger.error({args}, formatMessage(args));
  },
  info(...args: unknown[]): void {
    pinoLogger.info({args}, formatMessage(args));
  },
  log(...args: unknown[]): void {
    // Map 'log' to 'info' level
    pinoLogger.info({args}, formatMessage(args));
  },
  warn(...args: unknown[]): void {
    pinoLogger.warn({args}, formatMessage(args));
  },
};

/**
 * Direct pino logger for use in non-FastMCP code (like ynab-client.ts).
 * This bypasses FastMCP's context logger and writes directly to the log file.
 *
 * Use this for sync operations and other internal logging that needs
 * to be visible when the MCP client doesn't surface context logs.
 */
export const fileLogger = {
  debug(message: string, data?: Record<string, unknown>): void {
    pinoLogger.debug(data ?? {}, message);
  },
  error(message: string, data?: Record<string, unknown>): void {
    pinoLogger.error(data ?? {}, message);
  },
  info(message: string, data?: Record<string, unknown>): void {
    pinoLogger.info(data ?? {}, message);
  },
  warn(message: string, data?: Record<string, unknown>): void {
    pinoLogger.warn(data ?? {}, message);
  },
};

/**
 * Get the glob pattern for log files.
 * pino-roll names files as server.N.log where N is the rotation counter.
 */
export function getLogFilePattern(): string {
  return join(LOG_DIR, 'server.*.log');
}

/**
 * Get the log directory path.
 */
export function getLogDir(): string {
  return LOG_DIR;
}

// Log startup
pinoLogger.info(
  {
    level,
    logDir: LOG_DIR,
    nodeVersion: process.version,
  },
  'Logger initialized',
);
