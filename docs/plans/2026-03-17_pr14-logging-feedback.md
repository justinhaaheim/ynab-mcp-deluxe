# PR #14 Logging Feedback - Items 1-4

## Context

Addressing code review feedback on PR #14 (server payload logging). Focus on items 1-4.

## Work Items

### 1. Sanitize response headers (SECURITY)

- **File:** `src/payload-logger.ts:519-522`
- **Issue:** Response headers logged raw — could contain Set-Cookie, etc.
- **Fix:** Use existing `sanitizeHeaders()` on `response.headers` (it already accepts `Headers`)

### 2. ErrnoException type safety

- **File:** `src/payload-logger.ts:619`
- **Issue:** Unsafe `as NodeJS.ErrnoException` cast
- **Fix:** `if (error instanceof Error && 'code' in error && error.code !== 'ENOENT')`

### 3. Fire-and-forget error visibility

- **Files:** `src/fetch-interceptor.ts:163,196,205`
- **Issue:** `.catch(() => {})` silently swallows all errors
- **Fix:** Add `fileLogger.warn` in catch blocks (matching tool-logging.ts pattern)

### 4. Integration tests for file I/O

- **File:** New test content in `src/payload-logger.test.ts`
- **Tests needed:**
  - `writePayload` creates files on disk with expected JSON
  - `purgeOldPayloads` deletes old directories
  - Response clone round-trip in fetch interceptor
- **Approach:** Use temp directories via `mkdtemp`, clean up in afterEach

## Status

- [x] Plan
- [ ] Fix #1
- [ ] Fix #2
- [ ] Fix #3
- [ ] Fix #4
- [ ] Signal + commit
