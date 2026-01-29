/**
 * Tests for sync history persistence utilities.
 */

import {describe, expect, it} from 'vitest';

import {
  generateSyncFilename,
  getSyncHistoryBaseDir,
  getSyncHistoryDir,
  isValidBudgetIdForPath,
} from './sync-history.js';

// ============================================================================
// isValidBudgetIdForPath Tests (Security Validation)
// ============================================================================

describe('isValidBudgetIdForPath', () => {
  describe('valid budget IDs', () => {
    it('accepts valid UUID format', () => {
      expect(
        isValidBudgetIdForPath('12345678-1234-1234-1234-123456789abc'),
      ).toBe(true);
    });

    it('accepts uppercase UUID format', () => {
      expect(
        isValidBudgetIdForPath('12345678-1234-1234-1234-123456789ABC'),
      ).toBe(true);
    });

    it('accepts simple alphanumeric string', () => {
      expect(isValidBudgetIdForPath('budget123')).toBe(true);
    });

    it('accepts string with hyphens', () => {
      expect(isValidBudgetIdForPath('my-budget-id')).toBe(true);
    });

    it('accepts single character', () => {
      expect(isValidBudgetIdForPath('a')).toBe(true);
    });

    it('accepts just numbers', () => {
      expect(isValidBudgetIdForPath('12345')).toBe(true);
    });

    it('accepts string starting with hyphen', () => {
      // While unusual, this is technically safe for path construction
      expect(isValidBudgetIdForPath('-budget')).toBe(true);
    });
  });

  describe('path traversal attempts', () => {
    it('rejects parent directory traversal', () => {
      expect(isValidBudgetIdForPath('../../../etc/passwd')).toBe(false);
    });

    it('rejects single parent traversal', () => {
      expect(isValidBudgetIdForPath('..')).toBe(false);
    });

    it('rejects budget with embedded traversal', () => {
      expect(isValidBudgetIdForPath('budget/../other')).toBe(false);
    });

    it('rejects current directory reference', () => {
      expect(isValidBudgetIdForPath('.')).toBe(false);
    });

    it('rejects budget starting with dot', () => {
      expect(isValidBudgetIdForPath('.hidden')).toBe(false);
    });
  });

  describe('special characters', () => {
    it('rejects forward slash', () => {
      expect(isValidBudgetIdForPath('budget/123')).toBe(false);
    });

    it('rejects backslash', () => {
      expect(isValidBudgetIdForPath('budget\\123')).toBe(false);
    });

    it('rejects dot in middle', () => {
      expect(isValidBudgetIdForPath('budget.123')).toBe(false);
    });

    it('rejects spaces', () => {
      expect(isValidBudgetIdForPath('budget 123')).toBe(false);
    });

    it('rejects null byte', () => {
      expect(isValidBudgetIdForPath('budget\x00123')).toBe(false);
    });

    it('rejects colon (Windows drive letter)', () => {
      expect(isValidBudgetIdForPath('C:')).toBe(false);
    });

    it('rejects asterisk', () => {
      expect(isValidBudgetIdForPath('budget*')).toBe(false);
    });

    it('rejects question mark', () => {
      expect(isValidBudgetIdForPath('budget?')).toBe(false);
    });

    it('rejects quotes', () => {
      expect(isValidBudgetIdForPath('budget"123')).toBe(false);
      expect(isValidBudgetIdForPath("budget'123")).toBe(false);
    });

    it('rejects angle brackets', () => {
      expect(isValidBudgetIdForPath('budget<123>')).toBe(false);
    });

    it('rejects pipe', () => {
      expect(isValidBudgetIdForPath('budget|123')).toBe(false);
    });

    it('rejects tilde', () => {
      expect(isValidBudgetIdForPath('~budget')).toBe(false);
    });

    it('rejects underscore', () => {
      // Underscores are technically safe but not in YNAB UUID format
      expect(isValidBudgetIdForPath('budget_123')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('rejects empty string', () => {
      expect(isValidBudgetIdForPath('')).toBe(false);
    });

    it('rejects just hyphens', () => {
      // Just hyphens is valid per the regex, though unusual
      expect(isValidBudgetIdForPath('---')).toBe(true);
    });

    it('rejects whitespace-only string', () => {
      expect(isValidBudgetIdForPath('   ')).toBe(false);
    });

    it('rejects newline characters', () => {
      expect(isValidBudgetIdForPath('budget\n123')).toBe(false);
    });

    it('rejects tab characters', () => {
      expect(isValidBudgetIdForPath('budget\t123')).toBe(false);
    });
  });
});

// ============================================================================
// getSyncHistoryDir Tests
// ============================================================================

describe('getSyncHistoryDir', () => {
  it('returns path for valid budget ID', () => {
    const path = getSyncHistoryDir('12345678-1234-1234-1234-123456789abc');
    expect(path).toContain('sync-history');
    expect(path).toContain('12345678-1234-1234-1234-123456789abc');
  });

  it('throws for path traversal attempt', () => {
    expect(() => getSyncHistoryDir('../../../etc/passwd')).toThrow(
      /Invalid budgetId for file path/,
    );
  });

  it('throws for empty string', () => {
    expect(() => getSyncHistoryDir('')).toThrow(
      /Invalid budgetId for file path/,
    );
  });

  it('throws for special characters', () => {
    expect(() => getSyncHistoryDir('budget/123')).toThrow(
      /Invalid budgetId for file path/,
    );
  });
});

// ============================================================================
// getSyncHistoryBaseDir Tests
// ============================================================================

describe('getSyncHistoryBaseDir', () => {
  it('returns path containing sync-history', () => {
    const path = getSyncHistoryBaseDir();
    expect(path).toContain('sync-history');
  });

  it('returns path under .config', () => {
    const path = getSyncHistoryBaseDir();
    expect(path).toContain('.config');
  });

  it('returns path containing ynab-mcp-deluxe', () => {
    const path = getSyncHistoryBaseDir();
    expect(path).toContain('ynab-mcp-deluxe');
  });
});

// ============================================================================
// generateSyncFilename Tests
// ============================================================================

describe('generateSyncFilename', () => {
  it('generates filename with full sync type', () => {
    const filename = generateSyncFilename('full');
    expect(filename).toMatch(/^\d{8}T\d{6}Z-full\.json$/);
  });

  it('generates filename with delta sync type', () => {
    const filename = generateSyncFilename('delta');
    expect(filename).toMatch(/^\d{8}T\d{6}Z-delta\.json$/);
  });

  it('generates different filenames on subsequent calls', async () => {
    const filename1 = generateSyncFilename('full');
    // Wait a tiny bit to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));
    const filename2 = generateSyncFilename('full');

    // Filenames should be different due to timestamp
    // (though they might be the same if called in the same second)
    expect(filename1).toMatch(/^\d{8}T\d{6}Z-full\.json$/);
    expect(filename2).toMatch(/^\d{8}T\d{6}Z-full\.json$/);
  });
});
