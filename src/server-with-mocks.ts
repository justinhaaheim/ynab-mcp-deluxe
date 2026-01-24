/**
 * YNAB MCP Server with MSW mocks enabled
 *
 * Use this entry point to test the server without a real YNAB token.
 * All YNAB API calls will return Faker-generated mock data.
 *
 * Usage:
 *   bun run dev:mock
 *   # or
 *   YNAB_ACCESS_TOKEN=fake-token fastmcp dev src/server-with-mocks.ts
 */

import {server as mswServer} from './mocks/node.js';

// Start MSW before importing the MCP server
mswServer.listen({onUnhandledRequest: 'bypass'});

console.error(
  '[MSW] Mock server started - all YNAB API calls will return fake data',
);

// Set a fake token if not provided (MSW will intercept anyway)
const token = process.env['YNAB_ACCESS_TOKEN'];
if (token === undefined || token === '') {
  process.env['YNAB_ACCESS_TOKEN'] = 'mock-token-for-testing';
}

// Now import and start the actual server
void import('./server.js');
