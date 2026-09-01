#!/usr/bin/env bun
/**
 * Regenerate the MSW mock handlers from the live YNAB OpenAPI spec.
 *
 * Run with: `bun run generate:mocks`
 *
 * Why this is a script rather than a one-line package.json command:
 *
 * 1. VERSION RELABEL — msw-auto-mock's bundled OpenAPI parser rejects the
 *    `openapi: 3.1.1` version string (it supports up to 3.1.0). 3.1.1 is a
 *    patch-level errata release over 3.1.0 with no structural schema changes,
 *    so we relabel the version to 3.1.0 on a temp copy before generating. The
 *    committed spec (src/mocks/ynab-openapi.yaml) keeps the true 3.1.1.
 *
 * 2. FAKER BOUNDS — the generated response builders use unbounded
 *    `faker.number.int()` for numeric fields the spec doesn't constrain.
 *    `currency_format.decimal_digits` must be small (YNAB returns 0-4); an
 *    unbounded value makes `toFixed()` throw during currency conversion. We
 *    bound it in a post-processing step.
 *
 * Only `handlers.ts` is (re)generated here. `node.ts`, `browser.ts`,
 * `native.ts`, and `handler-overrides.ts` are hand-maintained and composed on
 * top of the generated handlers — see `handler-overrides.ts` for why.
 */
import {execSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';

const SPEC_URL = 'https://api.ynab.com/papi/open_api_spec.yaml';
const BASE_URL = 'https://api.ynab.com/v1';
const SPEC_PATH = 'src/mocks/ynab-openapi.yaml';
const HANDLERS_PATH = 'src/mocks/handlers.ts';
const TMP_DIR = 'tmp/mock-gen';

async function main(): Promise<void> {
  // 1. Fetch the current spec and commit it verbatim (true version).
  console.log(`Fetching spec from ${SPEC_URL} ...`);
  const specRes = await fetch(SPEC_URL);
  if (!specRes.ok) {
    throw new Error(
      `Failed to fetch spec: ${specRes.status} ${specRes.statusText}`,
    );
  }
  const spec = await specRes.text();
  writeFileSync(SPEC_PATH, spec);

  // 2. Relabel the OpenAPI version so msw-auto-mock's parser accepts it.
  mkdirSync(TMP_DIR, {recursive: true});
  const relabeled = spec.replace(/^openapi:\s*3\.1\.\d+/m, 'openapi: 3.1.0');
  const tmpSpec = `${TMP_DIR}/spec.yaml`;
  writeFileSync(tmpSpec, relabeled);

  // 3. Generate into a temp dir; we only keep handlers.ts.
  console.log('Running msw-auto-mock ...');
  execSync(
    `npx msw-auto-mock ${tmpSpec} -o ${TMP_DIR}/out --base-url ${BASE_URL} --typescript -c 200,201`,
    {stdio: 'inherit'},
  );

  // 4. Post-process: bound currency_format.decimal_digits (see header note).
  let handlers = readFileSync(`${TMP_DIR}/out/handlers.ts`, 'utf8');
  handlers = handlers.replace(
    /decimal_digits: faker\.number\.int\(\)/g,
    'decimal_digits: faker.number.int({ max: 4, min: 0 })',
  );
  writeFileSync(HANDLERS_PATH, handlers);

  // 5. Format to match the rest of the codebase.
  console.log('Formatting ...');
  execSync(`npx prettier --write ${HANDLERS_PATH}`, {stdio: 'inherit'});

  rmSync(TMP_DIR, {force: true, recursive: true});
  console.log(`Done. Regenerated ${HANDLERS_PATH}`);
}

void main();
