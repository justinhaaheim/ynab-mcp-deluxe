/**
 * Tests for fetch interceptor module.
 *
 * Tests URL detection, method extraction, header extraction,
 * and interceptor installation/uninstallation.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  installFetchInterceptor,
  uninstallFetchInterceptor,
} from './fetch-interceptor.js';

// ============================================================================
// Helper Function Tests (via integration)
// ============================================================================

describe('fetch interceptor', () => {
  // Store original fetch
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Ensure clean state
    uninstallFetchInterceptor();
  });

  afterEach(() => {
    // Restore original fetch if needed
    uninstallFetchInterceptor();
    globalThis.fetch = originalFetch;
  });

  describe('installation', () => {
    it('can be installed and uninstalled', () => {
      const beforeInstall = globalThis.fetch;

      installFetchInterceptor();
      const afterInstall = globalThis.fetch;

      uninstallFetchInterceptor();
      const afterUninstall = globalThis.fetch;

      // After install, fetch should be different (wrapped)
      expect(afterInstall).not.toBe(beforeInstall);

      // After uninstall, fetch should be restored
      expect(afterUninstall).toBe(beforeInstall);
    });

    it('handles double installation gracefully', () => {
      installFetchInterceptor();
      const afterFirstInstall = globalThis.fetch;

      installFetchInterceptor();
      const afterSecondInstall = globalThis.fetch;

      // Should be the same - second install should be no-op
      expect(afterSecondInstall).toBe(afterFirstInstall);
    });

    it('handles uninstall without install gracefully', () => {
      // Should not throw
      uninstallFetchInterceptor();
      uninstallFetchInterceptor();
    });
  });
});

// ============================================================================
// URL Detection Tests
// ============================================================================

describe('YNAB URL detection', () => {
  // These tests verify the fetch interceptor correctly identifies YNAB URLs
  // We test this by checking the behavior of the installed interceptor

  let originalFetch: typeof fetch;
  let fetchCallCount: number;

  beforeEach(() => {
    fetchCallCount = 0;
    originalFetch = globalThis.fetch;

    // Mock fetch to track calls
    globalThis.fetch = () => {
      fetchCallCount++;
      return Promise.resolve(new Response('{}', {status: 200}));
    };
  });

  afterEach(() => {
    uninstallFetchInterceptor();
    globalThis.fetch = originalFetch;
  });

  it('passes through non-YNAB URLs without modification', async () => {
    installFetchInterceptor();

    // Call fetch with non-YNAB URL
    await globalThis.fetch('https://example.com/api');

    // Should still work
    expect(fetchCallCount).toBe(1);
  });
});

// ============================================================================
// Header Extraction Tests (via exported helpers if available)
// ============================================================================

describe('header handling', () => {
  // These test the header extraction logic indirectly through the interceptor

  let originalFetch: typeof fetch;
  let lastRequestHeaders: Headers | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;

    // Mock fetch to capture headers
    globalThis.fetch = (_url, init) => {
      lastRequestHeaders = new Headers(init?.headers);
      return Promise.resolve(new Response('{}', {status: 200}));
    };
  });

  afterEach(() => {
    uninstallFetchInterceptor();
    globalThis.fetch = originalFetch;
    lastRequestHeaders = undefined;
  });

  it('preserves headers through interception', async () => {
    installFetchInterceptor();

    await globalThis.fetch('https://example.com/api', {
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'test-value',
      },
    });

    expect(lastRequestHeaders?.get('Content-Type')).toBe('application/json');
    expect(lastRequestHeaders?.get('X-Custom-Header')).toBe('test-value');
  });
});

// ============================================================================
// Method Extraction Tests
// ============================================================================

describe('method handling', () => {
  let originalFetch: typeof fetch;
  let lastRequestMethod: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;

    // Mock fetch to capture method
    globalThis.fetch = (_url, init) => {
      lastRequestMethod = init?.method ?? 'GET';
      return Promise.resolve(new Response('{}', {status: 200}));
    };
  });

  afterEach(() => {
    uninstallFetchInterceptor();
    globalThis.fetch = originalFetch;
    lastRequestMethod = undefined;
  });

  it('preserves GET method', async () => {
    installFetchInterceptor();

    await globalThis.fetch('https://example.com/api', {method: 'GET'});

    expect(lastRequestMethod).toBe('GET');
  });

  it('preserves POST method', async () => {
    installFetchInterceptor();

    await globalThis.fetch('https://example.com/api', {method: 'POST'});

    expect(lastRequestMethod).toBe('POST');
  });

  it('defaults to GET when no method specified', async () => {
    installFetchInterceptor();

    await globalThis.fetch('https://example.com/api');

    expect(lastRequestMethod).toBe('GET');
  });
});
