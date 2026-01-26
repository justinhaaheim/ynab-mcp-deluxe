/**
 * Sync providers for fetching budget data.
 *
 * SyncProvider is an abstraction that allows us to swap between:
 * - ApiSyncProvider: Uses the YNAB API (production)
 * - StaticSyncProvider: Loads from a JSON file (testing)
 *
 * This enables fast iteration and deterministic E2E tests.
 */

import type {SyncProvider} from './types.js';
import type {BudgetDetail} from 'ynab';

import {api as YnabApi} from 'ynab';

/**
 * API-based sync provider that fetches from the YNAB API.
 * This is the default provider for production use.
 */
export class ApiSyncProvider implements SyncProvider {
  private api: YnabApi;

  constructor(accessToken: string) {
    this.api = new YnabApi(accessToken);
  }

  /**
   * Perform a full sync - fetches the complete budget.
   */
  async fullSync(
    budgetId: string,
  ): Promise<{budget: BudgetDetail; serverKnowledge: number}> {
    const response = await this.api.budgets.getBudgetById(budgetId);
    return {
      budget: response.data.budget,
      serverKnowledge: response.data.server_knowledge,
    };
  }

  /**
   * Perform a delta sync - fetches only changes since lastKnowledge.
   */
  async deltaSync(
    budgetId: string,
    lastKnowledge: number,
  ): Promise<{budget: BudgetDetail; serverKnowledge: number}> {
    const response = await this.api.budgets.getBudgetById(
      budgetId,
      lastKnowledge,
    );
    return {
      budget: response.data.budget,
      serverKnowledge: response.data.server_knowledge,
    };
  }
}

/**
 * Static sync provider that loads from a JSON file.
 * Used for testing to avoid hitting the YNAB API.
 *
 * Currently a stub - full implementation will be added later.
 * See ROADMAP.md for "Static JSON Testing Mode" future enhancement.
 */
export class StaticSyncProvider implements SyncProvider {
  private budgetData: BudgetDetail;
  private serverKnowledge: number;

  constructor(budgetData: BudgetDetail, serverKnowledge = 1) {
    this.budgetData = budgetData;
    this.serverKnowledge = serverKnowledge;
  }

  /**
   * Full sync returns the static budget data.
   */
  fullSync(
    _budgetId: string,
  ): Promise<{budget: BudgetDetail; serverKnowledge: number}> {
    return Promise.resolve({
      budget: this.budgetData,
      serverKnowledge: this.serverKnowledge,
    });
  }

  /**
   * Delta sync returns empty changes (no changes since static data is immutable).
   * In the future, this could return changes from a mutations overlay.
   */
  deltaSync(
    _budgetId: string,
    _lastKnowledge: number,
  ): Promise<{budget: BudgetDetail; serverKnowledge: number}> {
    // Return an "empty" delta - same server knowledge, no changes
    // The budget object will have empty/undefined arrays, indicating no changes
    const emptyDelta: BudgetDetail = {
      id: this.budgetData.id,
      name: this.budgetData.name,
      // All other fields are optional and undefined = no changes
    };

    return Promise.resolve({
      budget: emptyDelta,
      serverKnowledge: this.serverKnowledge,
    });
  }
}

/**
 * Create the appropriate sync provider based on environment.
 *
 * If YNAB_STATIC_BUDGET_FILE is set, loads from that file.
 * Otherwise, uses the YNAB API with YNAB_ACCESS_TOKEN.
 *
 * @returns The configured SyncProvider
 * @throws Error if required environment variables are missing
 */
export function createSyncProvider(): SyncProvider {
  const staticBudgetFile = process.env['YNAB_STATIC_BUDGET_FILE'];

  if (staticBudgetFile !== undefined && staticBudgetFile !== '') {
    // Static mode - load from JSON file
    // Note: Full implementation will be added in future enhancement
    throw new Error(
      `Static budget file support not yet implemented. ` +
        `Set YNAB_STATIC_BUDGET_FILE is set to: ${staticBudgetFile}`,
    );
  }

  // API mode - use YNAB API
  const accessToken = process.env['YNAB_ACCESS_TOKEN'];
  if (accessToken === undefined || accessToken === '') {
    throw new Error(
      'YNAB authentication failed. Check that YNAB_ACCESS_TOKEN environment variable is set.',
    );
  }

  return new ApiSyncProvider(accessToken);
}
