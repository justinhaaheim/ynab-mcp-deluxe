/**
 * MCP Tool logging wrapper.
 *
 * Provides a wrapper function to add comprehensive request/response
 * logging to MCP tools without modifying each tool's implementation.
 */

import type {FastMCP} from 'fastmcp';
import type {z} from 'zod';

import {fileLogger} from './logger.js';
import {
  isPayloadLoggingEnabled,
  logMcpError,
  logMcpRequest,
  logMcpResponse,
  setSessionId,
} from './payload-logger.js';

/**
 * Tool annotations type (matching FastMCP)
 */
interface ToolAnnotations {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
  streamingHint?: boolean;
  title?: string;
}

/**
 * Context type passed to tool execute functions.
 */
interface ToolContext {
  client: {
    version: unknown;
  };
  log: {
    debug: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
    info: (message: string, data?: unknown) => void;
    warn: (message: string, data?: unknown) => void;
  };
  reportProgress: (progress: {
    progress: number;
    total?: number;
  }) => Promise<void>;
  requestId?: string;
  session?: unknown;
  sessionId?: string;
  streamContent: (content: unknown) => Promise<void>;
}

/**
 * Tool definition type (simplified for our wrapper needs).
 */
interface ToolDefinition<TParams extends z.ZodType = z.ZodType> {
  annotations?: ToolAnnotations;
  description?: string;
  execute: (args: z.infer<TParams>, context: ToolContext) => Promise<unknown>;
  name: string;
  parameters?: TParams;
  timeoutMs?: number;
}

/**
 * Wrap a tool's execute function with logging.
 * Returns a new tool definition with the execute function wrapped.
 */
export function wrapToolWithLogging<TParams extends z.ZodType>(
  tool: ToolDefinition<TParams>,
): ToolDefinition<TParams> {
  const originalExecute = tool.execute;

  const wrappedExecute = async (
    args: z.infer<TParams>,
    context: ToolContext,
  ): Promise<unknown> => {
    // Update session ID from MCP context
    setSessionId(context.sessionId);

    // Skip logging if disabled
    if (!isPayloadLoggingEnabled()) {
      return await originalExecute(args, context);
    }

    const startTime = performance.now();
    const toolName = tool.name;
    const requestId = context.requestId;

    // Log the request (fire and forget)
    logMcpRequest(toolName, args, requestId).catch((err) => {
      fileLogger.error('Failed to log MCP request', {
        error: err instanceof Error ? err.message : String(err),
        tool: toolName,
      });
    });

    try {
      // Execute the original tool
      const result = await originalExecute(args, context);

      // Log the response (fire and forget)
      logMcpResponse(toolName, startTime, result, requestId).catch((err) => {
        fileLogger.error('Failed to log MCP response', {
          error: err instanceof Error ? err.message : String(err),
          tool: toolName,
        });
      });

      return result;
    } catch (error) {
      // Log the error (fire and forget)
      logMcpError(toolName, startTime, error, requestId).catch((err) => {
        fileLogger.error('Failed to log MCP error', {
          error: err instanceof Error ? err.message : String(err),
          tool: toolName,
        });
      });

      // Re-throw the original error
      throw error;
    }
  };

  return {
    ...tool,
    execute: wrappedExecute,
  };
}

/**
 * Create a helper function that wraps addTool with logging.
 *
 * Usage:
 * ```typescript
 * const addTool = createLoggingToolAdder(server);
 * addTool({ name: 'my_tool', ... });
 * ```
 */
export function createLoggingToolAdder(server: FastMCP) {
  return function addToolWithLogging<TParams extends z.ZodType>(
    tool: ToolDefinition<TParams>,
  ): void {
    const wrappedTool = wrapToolWithLogging(tool);
    // @ts-expect-error - FastMCP types are complex, but this is correct at runtime
    server.addTool(wrappedTool);
  };
}
