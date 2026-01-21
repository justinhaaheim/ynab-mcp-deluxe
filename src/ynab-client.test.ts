/**
 * Sample test demonstrating MSW mock integration with the YNAB client
 */
import {describe, expect, it} from 'vitest';
import * as ynab from 'ynab';

describe('YNAB API Mocking', () => {
  it('should intercept API calls and return mocked data', async () => {
    // Create a YNAB API client pointing to the mocked base URL
    const api = new ynab.API('fake-access-token');

    // This call will be intercepted by MSW and return faker-generated data
    const response = await api.budgets.getBudgets();

    // Verify we got a response with the expected structure
    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.budgets).toBeDefined();
    expect(Array.isArray(response.data.budgets)).toBe(true);
  });

  it('should return mocked budget details', async () => {
    const api = new ynab.API('fake-access-token');

    // Use a fake budget ID - MSW will intercept and return mocked data
    const response = await api.budgets.getBudgetById('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.budget).toBeDefined();
  });

  it('should return mocked accounts', async () => {
    const api = new ynab.API('fake-access-token');

    const response = await api.accounts.getAccounts('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.accounts).toBeDefined();
    expect(Array.isArray(response.data.accounts)).toBe(true);
  });

  it('should return mocked categories', async () => {
    const api = new ynab.API('fake-access-token');

    const response = await api.categories.getCategories('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.category_groups).toBeDefined();
    expect(Array.isArray(response.data.category_groups)).toBe(true);
  });

  it('should return mocked transactions', async () => {
    const api = new ynab.API('fake-access-token');

    const response = await api.transactions.getTransactions('fake-budget-id');

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.transactions).toBeDefined();
    expect(Array.isArray(response.data.transactions)).toBe(true);
  });
});
