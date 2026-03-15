/**
 * Fetch interceptor for YNAB API requests and responses.
 *
 * Wraps the global fetch function to:
 * 1. Normalize responses (fix known SDK deserialization bugs)
 * 2. Optionally log all HTTP traffic for debugging
 *
 * Only intercepts requests to api.ynab.com, passing through all other requests.
 */

import {fileLogger} from './logger.js';
import {
  isPayloadLoggingEnabled,
  logYnabError,
  logYnabRequest,
  logYnabResponse,
} from './payload-logger.js';

const YNAB_API_HOST = 'api.ynab.com';

/** Intentional no-op for fire-and-forget promise catch handlers */
function noop(_error: unknown): void {
  // Intentionally swallowing logging errors — they should not affect API behavior
}

/**
 * Check if a URL is a YNAB API request.
 */
function isYnabApiUrl(url: string | URL | Request): boolean {
  try {
    let urlString: string;
    if (url instanceof Request) {
      urlString = url.url;
    } else if (url instanceof URL) {
      urlString = url.href;
    } else {
      urlString = url;
    }
    const urlObj = new URL(urlString);
    return urlObj.host === YNAB_API_HOST;
  } catch {
    return false;
  }
}

/**
 * Extract URL string from fetch input.
 */
function getUrlString(input: string | URL | Request): string {
  if (input instanceof Request) {
    return input.url;
  } else if (input instanceof URL) {
    return input.href;
  }
  return input;
}

/**
 * Extract method from fetch input and init.
 */
function getMethod(input: string | URL | Request, init?: RequestInit): string {
  if (input instanceof Request) {
    return init?.method ?? input.method ?? 'GET';
  }
  return init?.method ?? 'GET';
}

/**
 * Extract headers from fetch input and init.
 */
function getHeaders(
  input: string | URL | Request,
  init?: RequestInit,
): Record<string, string> {
  if (input instanceof Request) {
    // Merge request headers with init headers (init takes precedence)
    const requestHeaders: Record<string, string> = {};
    input.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    if (init?.headers !== undefined && init.headers !== null) {
      const initHeaders = new Headers(init.headers);
      initHeaders.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }
    return requestHeaders;
  }

  // For non-Request inputs, extract headers from init
  if (init?.headers === undefined || init.headers === null) {
    return {};
  }

  // Convert to Record<string, string>
  const result: Record<string, string> = {};
  const headers = new Headers(init.headers);
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Extract body from fetch input and init.
 */
async function getBody(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<unknown> {
  try {
    let body: RequestInit['body'] | string | undefined;

    if (input instanceof Request) {
      // Clone the request to read the body without consuming it
      if (init?.body !== undefined) {
        body = init.body;
      } else if (input.body !== null) {
        body = await input.clone().text();
      } else {
        body = undefined;
      }
    } else {
      body = init?.body;
    }

    if (body === null || body === undefined) {
      return undefined;
    }

    if (typeof body === 'string') {
      try {
        return JSON.parse(body) as unknown;
      } catch {
        return body;
      }
    }

    // For other body types, just return a placeholder
    return '[Body type not serializable]';
  } catch {
    return undefined;
  }
}

// Store the original fetch
let originalFetch: typeof fetch | null = null;

// ============================================================================
// Response Normalization
// ============================================================================

/**
 * Check if a URL is a budget detail endpoint (full or delta budget fetch).
 * These are the endpoints that return MonthDetail objects with categories.
 *
 * Matches: /v1/budgets/{budgetId} (with optional query params)
 * Does NOT match: /v1/budgets (list) or /v1/budgets/{id}/transactions etc.
 */
function isBudgetDetailUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Match /v1/budgets/{uuid} but not sub-resources like /transactions
    return /^\/v1\/budgets\/[^/]+\/?$/.test(urlObj.pathname);
  } catch {
    return false;
  }
}

/**
 * Normalize a YNAB API response body to fix known SDK deserialization bugs.
 *
 * Known issue: The YNAB API returns `categories: null` in MonthDetail objects
 * within delta responses when a month is affected but no categories changed.
 * The SDK's MonthDetailFromJSON crashes on `null.map()` (MonthDetail.js:51).
 *
 * This function normalizes `null` categories to `[]` before the SDK sees it.
 *
 * @returns true if the body was modified, false if no changes needed
 */
function normalizeResponseBody(body: Record<string, unknown>): boolean {
  let modified = false;

  // Navigate to data.budget.months
  const data = body['data'] as Record<string, unknown> | undefined;
  if (data === undefined) return false;

  const budget = data['budget'] as Record<string, unknown> | undefined;
  if (budget === undefined) return false;

  const months = budget['months'] as
    | Record<string, unknown>[]
    | null
    | undefined;
  if (!Array.isArray(months)) return false;

  for (const month of months) {
    if (month['categories'] === null || month['categories'] === undefined) {
      month['categories'] = [];
      modified = true;
    }
  }

  if (modified) {
    fileLogger.debug(
      'Normalized null categories in MonthDetail (YNAB SDK bug workaround)',
    );
  }

  return modified;
}

/**
 * Create a wrapped fetch that normalizes and optionally logs YNAB API responses.
 */
function createInterceptingFetch(baseFetch: typeof fetch): typeof fetch {
  return async function interceptingFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    // Pass through non-YNAB requests
    if (!isYnabApiUrl(input)) {
      return await baseFetch(input, init);
    }

    const url = getUrlString(input);
    const method = getMethod(input, init);
    const doLog = isPayloadLoggingEnabled();
    const startTime = performance.now();

    try {
      // Log request (fire and forget)
      if (doLog) {
        const headers = getHeaders(input, init);
        const body = await getBody(input, init);
        logYnabRequest(method, url, headers, body).catch(noop);
      }

      // Execute the actual fetch
      const response = await baseFetch(input, init);

      // Check if this is a budget detail response that may need normalization
      const needsNormalization =
        response.ok && method === 'GET' && isBudgetDetailUrl(url);

      if (!needsNormalization && !doLog) {
        // Nothing to do — return response as-is
        return response;
      }

      // We need to read the body (for normalization and/or logging)
      let responseBody: unknown;
      try {
        // Clone if we only need to log (not normalize), read directly if normalizing
        if (needsNormalization) {
          responseBody = await response.json();
        } else {
          responseBody = await response.clone().json();
        }
      } catch (jsonError) {
        try {
          responseBody = needsNormalization
            ? await response.text()
            : await response.clone().text();
        } catch (textError) {
          responseBody = {
            _parseError: 'Unable to read response body',
            jsonError:
              jsonError instanceof Error
                ? jsonError.message
                : String(jsonError),
            textError:
              textError instanceof Error
                ? textError.message
                : String(textError),
          };
        }
      }

      // Log response (fire and forget)
      if (doLog) {
        logYnabResponse(method, url, response, responseBody, startTime).catch(
          noop,
        );
      }

      // Apply normalization and return reconstructed Response
      // (body was consumed by .json() so we must reconstruct regardless)
      if (needsNormalization) {
        if (typeof responseBody === 'object' && responseBody !== null) {
          normalizeResponseBody(responseBody as Record<string, unknown>);
        }
        return new Response(JSON.stringify(responseBody), {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        });
      }

      return response;
    } catch (error) {
      // Log error (fire and forget)
      if (doLog) {
        logYnabError(method, url, error, startTime).catch(noop);
      }
      throw error;
    }
  };
}

/**
 * Install the fetch interceptor globally.
 * Call this once at server startup.
 *
 * The interceptor always normalizes YNAB API responses (to work around SDK bugs).
 * Logging is applied conditionally based on YNAB_PAYLOAD_LOGGING.
 */
export function installFetchInterceptor(): void {
  if (originalFetch !== null) {
    fileLogger.debug('Fetch interceptor already installed');
    return;
  }

  // Store original fetch
  originalFetch = globalThis.fetch;

  // Replace with intercepting version (normalization + optional logging)
  globalThis.fetch = createInterceptingFetch(originalFetch);

  fileLogger.info(
    'Fetch interceptor installed (response normalization + optional logging)',
  );
}

/**
 * Uninstall the fetch interceptor, restoring the original fetch.
 * Useful for testing.
 */
export function uninstallFetchInterceptor(): void {
  if (originalFetch !== null) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
    fileLogger.info('Fetch interceptor uninstalled');
  }
}
