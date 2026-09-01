/**
 * Hand-written MSW handler overrides layered on top of the auto-generated
 * handlers in `handlers.ts`.
 *
 * WHY THIS FILE EXISTS: the write endpoints below echo properties from the
 * request (or URL params) back into the response, so that mutation-response
 * validation (see `mutation-validation.ts`) — which checks that a write
 * response matches what was requested — passes in tests. The default
 * auto-generated handlers return random faker data that (correctly) fails that
 * validation.
 *
 * These are kept SEPARATE from `handlers.ts` so that `bun run generate:mocks`
 * can regenerate the base handlers from the current YNAB OpenAPI spec WITHOUT
 * clobbering these customizations. They are composed BEFORE the generated
 * handlers (MSW uses the first matching handler) — see `node.ts`.
 */
import {faker} from '@faker-js/faker';
import {http, HttpResponse} from 'msw';

import {
  getCreateAccount201Response,
  getCreateTransaction201Response,
  getDeleteTransaction200Response,
  getUpdateMonthCategory200Response,
  getUpdateTransactions200Response,
} from './handlers.js';

const baseURL = 'https://api.ynab.com/v1';

const generateTransactionDetail = () => ({
  account_id: faker.string.uuid(),
  account_name: faker.company.name(),
  amount: faker.number.int(),
  approved: faker.datatype.boolean(),
  category_id: faker.string.uuid(),
  category_name: faker.commerce.department(),
  cleared: faker.helpers.arrayElement(['cleared', 'uncleared', 'reconciled']),
  date: faker.date.past().toISOString().substring(0, 10),
  debt_transaction_type: null,
  deleted: false,
  flag_color: faker.helpers.arrayElement([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    '',
    null,
  ]),
  flag_name: faker.person.fullName(),
  id: faker.string.uuid(),
  import_id: null,
  import_payee_name: null,
  import_payee_name_original: null,
  matched_transaction_id: null,
  memo: faker.lorem.words(),
  payee_id: faker.string.uuid(),
  payee_name: faker.person.fullName(),
  subtransactions: [],
  transfer_account_id: null,
  transfer_transaction_id: null,
});

export const overrideHandlers = [
  // POST /plans/:budgetId/accounts — echo the requested account name/type/balance
  http.post(`${baseURL}/plans/:budgetId/accounts`, async ({request}) => {
    const body = (await request.json()) as {
      account?: {balance: number; name: string; type: string};
    };
    const baseResponse = getCreateAccount201Response() as {
      data: {account: {balance: number; name: string; type: string}};
    };

    if (body.account != null) {
      baseResponse.data.account.name = body.account.name;
      baseResponse.data.account.type = body.account.type;
      baseResponse.data.account.balance = body.account.balance;
    }

    return HttpResponse.json(baseResponse, {status: 201});
  }),

  // POST /plans/:budgetId/transactions — return one created transaction per
  // requested transaction (and no duplicates).
  http.post(`${baseURL}/plans/:budgetId/transactions`, async ({request}) => {
    const body = (await request.json()) as {transactions?: unknown[]};
    const baseResponse = getCreateTransaction201Response() as {
      data: {duplicate_import_ids: unknown[]; transactions: unknown[]};
    };

    if (body.transactions != null && body.transactions.length > 0) {
      baseResponse.data.transactions = body.transactions.map(() =>
        generateTransactionDetail(),
      );
      baseResponse.data.duplicate_import_ids = [];
    }

    return HttpResponse.json(baseResponse, {status: 201});
  }),

  // PATCH /plans/:budgetId/transactions — echo back the requested transaction IDs
  http.patch(`${baseURL}/plans/:budgetId/transactions`, async ({request}) => {
    const body = (await request.json()) as {transactions?: {id: string}[]};
    const baseResponse = getUpdateTransactions200Response() as {
      data: {transactions: unknown[]};
    };

    if (body.transactions != null && body.transactions.length > 0) {
      baseResponse.data.transactions = body.transactions.map(
        (tx: {id: string}) => ({
          ...generateTransactionDetail(),
          id: tx.id,
        }),
      );
    }

    return HttpResponse.json(baseResponse, {status: 200});
  }),

  // PATCH /plans/:budgetId/months/:month/categories/:categoryId — echo the
  // category ID from the URL.
  http.patch(
    `${baseURL}/plans/:budgetId/months/:month/categories/:categoryId`,
    ({params}) => {
      const baseResponse = getUpdateMonthCategory200Response() as {
        data: {category: {id: string}};
      };
      baseResponse.data.category.id = params['categoryId'] as string;
      return HttpResponse.json(baseResponse, {status: 200});
    },
  ),

  // DELETE /plans/:budgetId/transactions/:transactionId — echo the transaction
  // ID from the URL.
  http.delete(
    `${baseURL}/plans/:budgetId/transactions/:transactionId`,
    ({params}) => {
      const baseResponse = getDeleteTransaction200Response() as {
        data: {transaction: {id: string}};
      };
      baseResponse.data.transaction.id = params['transactionId'] as string;
      return HttpResponse.json(baseResponse, {status: 200});
    },
  ),
];
