/**
 * @file TasksUpdateTimeInLine.test.ts
 * @brief Tests for updateTimeInLine — inserting, updating and removing time
 *        blocks in task markdown lines, in both 24h and 12h modes.
 */

import { updateTimeInLine } from '../TasksPluginProvider';

// A typical task line produced by updateTaskLine (⏳ is always present).
const BASE = '- [ ] My task ⏳ 2024-06-15';
const BASE_BLOCK = '- [ ] My task ⏳ 2024-06-15 ^abc123';
const WITH_TIME = '- [ ] My task (9:00) ⏳ 2024-06-15';
const WITH_RANGE = '- [ ] My task (9:00-10:30) ⏳ 2024-06-15';
const WITH_TIME_12H = '- [ ] My task (9:00 AM) ⏳ 2024-06-15';
const WITH_RANGE_12H = '- [ ] My task (9:00 AM-5:00 PM) ⏳ 2024-06-15';

describe('updateTimeInLine (24h mode, default)', () => {
  describe('inserting a time block', () => {
    it('inserts a single time before ⏳ when no time was present', () => {
      expect(updateTimeInLine(BASE, '9:00', null)).toBe('- [ ] My task (9:00) ⏳ 2024-06-15');
    });

    it('inserts a time range before ⏳ when no time was present', () => {
      expect(updateTimeInLine(BASE, '9:00', '10:30')).toBe(
        '- [ ] My task (9:00-10:30) ⏳ 2024-06-15'
      );
    });

    it('preserves a block link when inserting time with no ⏳ fallback', () => {
      const line = '- [ ] My task ^abc123';
      expect(updateTimeInLine(line, '14:00', null)).toBe('- [ ] My task (14:00) ^abc123');
    });

    it('inserts a time block before the configured date marker', () => {
      const dueLine = `- [ ] My task ${String.fromCodePoint(0x1f4c5)} 2024-06-15`;
      expect(updateTimeInLine(dueLine, '9:00', null, true, String.fromCodePoint(0x1f4c5))).toBe(
        `- [ ] My task (9:00) ${String.fromCodePoint(0x1f4c5)} 2024-06-15`
      );
    });
  });

  describe('updating an existing time block', () => {
    it('replaces an existing single time with a new single time', () => {
      expect(updateTimeInLine(WITH_TIME, '11:00', null)).toBe(
        '- [ ] My task (11:00) ⏳ 2024-06-15'
      );
    });

    it('replaces an existing single time with a new range', () => {
      expect(updateTimeInLine(WITH_TIME, '11:00', '12:00')).toBe(
        '- [ ] My task (11:00-12:00) ⏳ 2024-06-15'
      );
    });

    it('replaces an existing range with a new range (resize)', () => {
      expect(updateTimeInLine(WITH_RANGE, '9:00', '11:00')).toBe(
        '- [ ] My task (9:00-11:00) ⏳ 2024-06-15'
      );
    });

    it('replaces an existing range with a single time', () => {
      expect(updateTimeInLine(WITH_RANGE, '9:00', '9:00')).toBe(
        '- [ ] My task (9:00) ⏳ 2024-06-15'
      );
    });

    it('replaces a 12h time block with a 24h time block', () => {
      expect(updateTimeInLine(WITH_TIME_12H, '09:00', null, true)).toBe(
        '- [ ] My task (9:00) ⏳ 2024-06-15'
      );
    });

    it('replaces a 12h range with a 24h range', () => {
      expect(updateTimeInLine(WITH_RANGE_12H, '09:00', '17:00', true)).toBe(
        '- [ ] My task (9:00-17:00) ⏳ 2024-06-15'
      );
    });
  });

  describe('removing the time block (all-day drop)', () => {
    it('removes a single time block when startTime is null', () => {
      expect(updateTimeInLine(WITH_TIME, null, null)).toBe('- [ ] My task ⏳ 2024-06-15');
    });

    it('removes a time range when startTime is null', () => {
      expect(updateTimeInLine(WITH_RANGE, null, null)).toBe('- [ ] My task ⏳ 2024-06-15');
    });

    it('removes a 12h time block when startTime is null', () => {
      expect(updateTimeInLine(WITH_TIME_12H, null, null)).toBe('- [ ] My task ⏳ 2024-06-15');
    });

    it('removes a 12h range when startTime is null', () => {
      expect(updateTimeInLine(WITH_RANGE_12H, null, null)).toBe('- [ ] My task ⏳ 2024-06-15');
    });

    it('is a no-op on a line that has no time block', () => {
      expect(updateTimeInLine(BASE, null, null)).toBe(BASE);
    });
  });

  describe('block link preservation', () => {
    it('preserves a block link when adding a time', () => {
      expect(updateTimeInLine(BASE_BLOCK, '8:00', '9:00')).toBe(
        '- [ ] My task (8:00-9:00) ⏳ 2024-06-15 ^abc123'
      );
    });

    it('preserves a block link when removing a time', () => {
      const line = '- [ ] My task (9:00) ⏳ 2024-06-15 ^abc123';
      expect(updateTimeInLine(line, null, null)).toBe('- [ ] My task ⏳ 2024-06-15 ^abc123');
    });
  });

  describe('single-digit hour support', () => {
    it('handles single-digit start and end hours', () => {
      expect(updateTimeInLine(BASE, '8:00', '9:30')).toBe(
        '- [ ] My task (8:00-9:30) ⏳ 2024-06-15'
      );
    });

    it('replaces a single-digit hour time block', () => {
      const line = '- [ ] My task (8:00) ⏳ 2024-06-15';
      expect(updateTimeInLine(line, '9:00', null)).toBe('- [ ] My task (9:00) ⏳ 2024-06-15');
    });
  });
});

describe('updateTimeInLine (12h mode)', () => {
  const use12h = false; // timeFormat24h = false

  describe('inserting a 12h time block', () => {
    it('inserts a 12h single time before ⏳', () => {
      expect(updateTimeInLine(BASE, '09:00', null, use12h)).toBe(
        '- [ ] My task (9:00 AM) ⏳ 2024-06-15'
      );
    });

    it('inserts a 12h range before ⏳', () => {
      expect(updateTimeInLine(BASE, '09:00', '17:00', use12h)).toBe(
        '- [ ] My task (9:00 AM-5:00 PM) ⏳ 2024-06-15'
      );
    });

    it('formats noon correctly', () => {
      expect(updateTimeInLine(BASE, '12:00', null, use12h)).toBe(
        '- [ ] My task (12:00 PM) ⏳ 2024-06-15'
      );
    });

    it('formats midnight correctly', () => {
      expect(updateTimeInLine(BASE, '00:00', null, use12h)).toBe(
        '- [ ] My task (12:00 AM) ⏳ 2024-06-15'
      );
    });
  });

  describe('replacing an existing time block with 12h output', () => {
    it('replaces a 24h time block with a 12h block', () => {
      expect(updateTimeInLine(WITH_TIME, '09:00', null, use12h)).toBe(
        '- [ ] My task (9:00 AM) ⏳ 2024-06-15'
      );
    });

    it('replaces a 12h time block with an updated 12h block', () => {
      expect(updateTimeInLine(WITH_TIME_12H, '10:00', null, use12h)).toBe(
        '- [ ] My task (10:00 AM) ⏳ 2024-06-15'
      );
    });
  });

  describe('removing a 12h time block', () => {
    it('removes a 12h single time when startTime is null', () => {
      expect(updateTimeInLine(WITH_TIME_12H, null, null)).toBe('- [ ] My task ⏳ 2024-06-15');
    });

    it('removes a 12h range when startTime is null', () => {
      expect(updateTimeInLine(WITH_RANGE_12H, null, null)).toBe('- [ ] My task ⏳ 2024-06-15');
    });
  });
});

describe('updateTimeInLine (day planner format)', () => {
  it('moves time range to the front in 24h format', () => {
    expect(updateTimeInLine(BASE, '05:00', '19:00', false, '⏳', 'dayPlanner')).toBe(
      '- [ ] 5:00 - 19:00 My task ⏳ 2024-06-15'
    );
  });

  it('replaces legacy parenthesized time with day planner prefix', () => {
    expect(updateTimeInLine(WITH_RANGE_12H, '05:00', '19:00', false, '⏳', 'dayPlanner')).toBe(
      '- [ ] 5:00 - 19:00 My task ⏳ 2024-06-15'
    );
  });

  it('keeps block links while rewriting day planner format', () => {
    const line = '- [ ] My task (9:00 AM-5:00 PM) ⏳ 2024-06-15 ^abc123';
    expect(updateTimeInLine(line, '05:00', '19:00', true, '⏳', 'dayPlanner')).toBe(
      '- [ ] 5:00 - 19:00 My task ⏳ 2024-06-15 ^abc123'
    );
  });
});
