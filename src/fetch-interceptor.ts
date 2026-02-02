/**
 * Fetch interceptor for logging YNAB API requests and responses.
 *
 * Wraps the global fetch function to capture all HTTP traffic to the YNAB API.
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

/**
 * Create a logging wrapper around fetch.
 */
function createLoggingFetch(baseFetch: typeof fetch): typeof fetch {
  return async function loggingFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    // Only intercept YNAB API requests
    if (!isYnabApiUrl(input) || !isPayloadLoggingEnabled()) {
      return await baseFetch(input, init);
    }

    const url = getUrlString(input);
    const method = getMethod(input, init);
    const headers = getHeaders(input, init);
    const startTime = performance.now();

    try {
      // Log request (don't await - fire and forget)
      const body = await getBody(input, init);
      logYnabRequest(method, url, headers, body).catch(() => {
        // Ignore logging errors
      });

      // Execute the actual fetch
      const response = await baseFetch(input, init);

      // Clone the response to read the body without consuming it
      const responseClone = response.clone();

      // Try to parse response body as JSON
      let responseBody: unknown;
      try {
        responseBody = await responseClone.json();
      } catch {
        try {
          responseBody = await responseClone.text();
        } catch {
          responseBody = '[Unable to read response body]';
        }
      }

      // Log response (don't await - fire and forget)
      logYnabResponse(method, url, response, responseBody, startTime).catch(
        () => {
          // Ignore logging errors
        },
      );

      return response;
    } catch (error) {
      // Log error (don't await - fire and forget)
      logYnabError(method, url, error, startTime).catch(() => {
        // Ignore logging errors
      });
      throw error;
    }
  };
}

/**
 * Install the fetch interceptor globally.
 * Call this once at server startup.
 */
export function installFetchInterceptor(): void {
  if (originalFetch !== null) {
    fileLogger.debug('Fetch interceptor already installed');
    return;
  }

  if (!isPayloadLoggingEnabled()) {
    fileLogger.debug('Payload logging disabled, skipping fetch interceptor');
    return;
  }

  // Store original fetch
  originalFetch = globalThis.fetch;

  // Replace with logging version
  globalThis.fetch = createLoggingFetch(originalFetch);

  fileLogger.info('Fetch interceptor installed for YNAB API logging');
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
