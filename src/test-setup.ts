/**
 * Vitest setup file for MSW integration
 *
 * This file configures Mock Service Worker to intercept HTTP requests
 * during tests, using auto-generated handlers from the YNAB OpenAPI spec.
 */
import {afterAll, afterEach, beforeAll} from 'vitest';

import {server} from './mocks/node';

// Start MSW server before all tests
beforeAll(() => {
  server.listen({onUnhandledRequest: 'warn'});
});

// Reset handlers after each test (removes any runtime overrides)
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
