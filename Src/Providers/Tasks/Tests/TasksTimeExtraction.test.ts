/**
 * @file TasksTimeExtraction.test.ts
 * @brief Tests for time pattern extraction from task titles.
 */

import { extractTimeFromTitle } from '../TasksPluginProvider';

describe('extractTimeFromTitle', () => {
  it('returns no time info for a plain title', () => {
    expect(extractTimeFromTitle('Buy groceries')).toEqual({
      startTime: null,
      endTime: null,
      cleanTitle: 'Buy groceries'
    });
  });

  it('extracts a single time (HH:MM)', () => {
    expect(extractTimeFromTitle('Team meeting (18:00)')).toEqual({
      startTime: '18:00',
      endTime: null,
      cleanTitle: 'Team meeting'
    });
  });

  it('extracts a time range (HH:MM-HH:MM)', () => {
    expect(extractTimeFromTitle('Team meeting (18:00-20:00)')).toEqual({
      startTime: '18:00',
      endTime: '20:00',
      cleanTitle: 'Team meeting'
    });
  });

  it('handles time pattern at the start of title', () => {
    expect(extractTimeFromTitle('(09:00-10:00) Morning standup')).toEqual({
      startTime: '09:00',
      endTime: '10:00',
      cleanTitle: 'Morning standup'
    });
  });

  it('handles time pattern in the middle of title', () => {
    expect(extractTimeFromTitle('Call with (14:30-15:00) client')).toEqual({
      startTime: '14:30',
      endTime: '15:00',
      cleanTitle: 'Call with client'
    });
  });

  it('prefers the range pattern over single time when both formats could match', () => {
    const result = extractTimeFromTitle('Event (10:00-11:00)');
    expect(result.startTime).toBe('10:00');
    expect(result.endTime).toBe('11:00');
  });

  it('strips the time pattern from the title', () => {
    const { cleanTitle } = extractTimeFromTitle('Dentist (08:30)');
    expect(cleanTitle).toBe('Dentist');
  });

  it('extracts a single-digit hour time (H:MM)', () => {
    expect(extractTimeFromTitle('Morning run (9:00)')).toEqual({
      startTime: '9:00',
      endTime: null,
      cleanTitle: 'Morning run'
    });
  });

  it('extracts a time range with single-digit hours (H:MM-H:MM)', () => {
    expect(extractTimeFromTitle('Yoga class (8:00-9:30)')).toEqual({
      startTime: '8:00',
      endTime: '9:30',
      cleanTitle: 'Yoga class'
    });
  });

  it('extracts a mixed range with single and double-digit hours', () => {
    expect(extractTimeFromTitle('Long meeting (9:00-10:30)')).toEqual({
      startTime: '9:00',
      endTime: '10:30',
      cleanTitle: 'Long meeting'
    });
  });

  it('does not match partial time-like patterns without parentheses', () => {
    expect(extractTimeFromTitle('Meet at 18:00 for dinner')).toEqual({
      startTime: null,
      endTime: null,
      cleanTitle: 'Meet at 18:00 for dinner'
    });
  });

  // --- 12h AM/PM format ---

  it('extracts a single 12h time with uppercase AM', () => {
    expect(extractTimeFromTitle('Dentist (9:00 AM)')).toEqual({
      startTime: '9:00 AM',
      endTime: null,
      cleanTitle: 'Dentist'
    });
  });

  it('extracts a single 12h time with lowercase am (normalises to uppercase)', () => {
    expect(extractTimeFromTitle('Yoga (7:30am)')).toEqual({
      startTime: '7:30 AM',
      endTime: null,
      cleanTitle: 'Yoga'
    });
  });

  it('extracts a 12h time range', () => {
    expect(extractTimeFromTitle('Meeting (9:00 AM-5:00 PM)')).toEqual({
      startTime: '9:00 AM',
      endTime: '5:00 PM',
      cleanTitle: 'Meeting'
    });
  });

  it('normalises AM/PM to uppercase with a space even when no space was present', () => {
    expect(extractTimeFromTitle('Standup (9:00AM-10:00AM)')).toEqual({
      startTime: '9:00 AM',
      endTime: '10:00 AM',
      cleanTitle: 'Standup'
    });
  });

  it('strips a 12h time pattern from the title', () => {
    const { cleanTitle } = extractTimeFromTitle('Lunch (12:00 PM)');
    expect(cleanTitle).toBe('Lunch');
  });

  it('extracts day planner leading range format', () => {
    expect(extractTimeFromTitle('5:00 - 19:00 Wellness - Task - edit 2')).toEqual({
      startTime: '5:00',
      endTime: '19:00',
      cleanTitle: 'Wellness - Task - edit 2'
    });
  });

  it('extracts day planner leading single-time format', () => {
    expect(extractTimeFromTitle('7:30 Standup')).toEqual({
      startTime: '7:30',
      endTime: null,
      cleanTitle: 'Standup'
    });
  });
});
