import { __testing } from './sync';
import { createContinuityBlocksAndReplacePriorEvent } from './sync-continuity';
import { getCalendarEventsInRange } from './sync-utils';
import { PluginState } from "../../Core/PluginState";
import type { ProviderRegistry } from "../../Providers/ProviderRegistry";
import type EventCache from "../../Core/EventCache";

jest.mock('obsidian', () => {
  const moment = (input?: string | number, _format?: string, _strict?: boolean) => {
    const date =
      typeof input === 'number'
        ? new Date(input)
        : typeof input === 'string'
          ? new Date(input.replace(' ', 'T'))
          : new Date();
    return {
      isValid: () => !Number.isNaN(date.getTime()),
      valueOf: () => date.getTime(),
      format: (pattern?: string) => {
        const iso = date.toISOString();
        if (pattern === 'YYYY-MM-DD') return iso.slice(0, 10);
        if (pattern === 'HH:mm') return iso.slice(11, 16);
        return iso;
      }
    };
  };

  return {
    moment,
    Notice: jest.fn(),
    requestUrl: jest.fn()
  };
});

describe('ActivityWatch continuity helpers', () => {
  const setPluginStateFromMock = (plugin: unknown) => {
    const state = plugin as {
      providerRegistry: ProviderRegistry;
      cache: EventCache;
    };

    PluginState.setProviderRegistry(state.providerRegistry);
    PluginState.setCache(state.cache);
  };

  const makePrior = (overrides: Partial<unknown> = {}) =>
    ({
      sessionId: 's1',
      calendarId: 'aw',
      cleanTitle: 'Focus Work',
      startMs: 1_000,
      endMs: 5_000,
      event: {
        type: 'single',
        title: 'Focus Work',
        category: 'blue',
        date: '2026-04-14',
        endDate: null,
        allDay: false,
        startTime: '00:00',
        endTime: '00:01',
        display: 'auto'
      },
      ...overrides
    }) as never;

  it('pickLatestEvent prefers largest end, then largest start', () => {
    const events = [
      makePrior({ startMs: 1_000, endMs: 9_000 }),
      makePrior({ startMs: 2_000, endMs: 9_000 }),
      makePrior({ startMs: 3_000, endMs: 8_000 })
    ];

    const picked = __testing.pickLatestEvent(events);
    expect(picked?.endMs).toBe(9_000);
    expect(picked?.startMs).toBe(2_000);
  });

  it('pickBestReconstructedBlockForPriorEvent prefers profile match with highest overlap', () => {
    const prior = makePrior({
      event: {
        type: 'single',
        title: 'Old',
        category: 'blue',
        date: '2026-04-14',
        endDate: null,
        allDay: false,
        startTime: '00:00',
        endTime: '00:01',
        display: 'auto'
      },
      cleanTitle: 'Old'
    });

    const blocks = [
      {
        startMs: 1_000,
        endMs: 3_000,
        title: 'A',
        profileColor: 'blue',
        profileName: 'Coding'
      },
      {
        startMs: 500,
        endMs: 5_000,
        title: 'B',
        profileColor: 'green',
        profileName: 'Study'
      },
      {
        startMs: 1_000,
        endMs: 5_000,
        title: 'C',
        profileColor: 'blue',
        profileName: 'Coding'
      }
    ];

    const picked = __testing.pickBestReconstructedBlockForPriorEvent(blocks, prior);
    expect(picked?.title).toBe('C');
  });

  it('coversPriorEventRange accepts near-full coverage with continuity buffer tolerance', () => {
    const prior = makePrior({ startMs: 10_000, endMs: 70_000 });
    const blocks = [
      {
        startMs: 10_000,
        endMs: 39_500,
        title: 'A',
        profileColor: 'blue',
        profileName: 'Coding'
      },
      {
        startMs: 39_500,
        endMs: 69_500,
        title: 'B',
        profileColor: 'blue',
        profileName: 'Coding'
      }
    ];

    const ok = __testing.coversPriorEventRange(blocks, prior, 1_000);
    expect(ok).toBe(true);
  });

  it('coversPriorEventRange rejects when uncovered gap exceeds tolerance', () => {
    const prior = makePrior({ startMs: 10_000, endMs: 70_000 });
    const blocks = [
      {
        startMs: 10_000,
        endMs: 35_000,
        title: 'A',
        profileColor: 'blue',
        profileName: 'Coding'
      },
      {
        startMs: 40_000,
        endMs: 65_000,
        title: 'B',
        profileColor: 'blue',
        profileName: 'Coding'
      }
    ];

    const ok = __testing.coversPriorEventRange(blocks, prior, 1_000);
    expect(ok).toBe(false);
  });

  it('does not create replacement blocks when the provider cannot delete prior events', async () => {
    const addEvent = jest.fn();
    const deleteEvent = jest.fn();
    const plugin = {
      cache: {
        addEvent,
        deleteEvent
      }
    };
    const prior = makePrior({ startMs: 10_000, endMs: 70_000 });
    const blocks = [
      {
        startMs: 10_000,
        endMs: 120_000,
        title: 'Focus Work',
        profileColor: 'blue',
        profileName: 'Focus'
      }
    ];

    const count = await createContinuityBlocksAndReplacePriorEvent(
      plugin as never,
      'aw',
      new Map(),
      blocks,
      prior,
      false,
      [prior],
      new Set(['blue'])
    );

    expect(count).toBe(0);
    expect(addEvent).not.toHaveBeenCalled();
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('does not create replacement blocks when the prior event session id cannot be resolved', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const addEvent = jest.fn();
    const deleteEvent = jest.fn();
    const plugin = {
      cache: {
        addEvent,
        deleteEvent
      }
    };
    const prior = makePrior({
      sessionId: null,
      startMs: 10_000,
      endMs: 70_000
    });
    const blocks = [
      {
        startMs: 10_000,
        endMs: 120_000,
        title: 'Focus Work',
        profileColor: 'blue',
        profileName: 'Focus'
      }
    ];

    try {
      const count = await createContinuityBlocksAndReplacePriorEvent(
        plugin as never,
        'aw',
        new Map(),
        blocks,
        prior,
        true,
        [prior],
        new Set(['blue'])
      );

      expect(count).toBe(0);
      expect(addEvent).not.toHaveBeenCalled();
      expect(deleteEvent).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('uses the cached normalized event when provider range reads return raw daily-note events', async () => {
    const rawDailyNoteEvent = {
      type: 'single',
      title: 'Focus Work',
      uid: '1',
      date: '2026-04-14',
      endDate: null,
      allDay: false,
      startTime: '10:00',
      endTime: '10:30',
      display: 'auto'
    };
    const cachedActivityWatchEvent = {
      ...rawDailyNoteEvent,
      category: 'blue'
    };
    const enhance = jest.fn(() => ({
      ...rawDailyNoteEvent,
      category: 'should-not-be-used'
    }));
    const plugin = {
      providerRegistry: {
        getInstance: jest.fn(() => ({
          getEvents: jest.fn(() => Promise.resolve([[rawDailyNoteEvent, null]]))
        })),
        getGlobalIdentifier: jest.fn(() => 'aw::2026-04-14::uid:1'),
        getSessionId: jest.fn(() => Promise.resolve('session-1')),
        getCanonicalTitle: jest.fn((event: typeof cachedActivityWatchEvent) => event.title)
      },
      cache: {
        enhancer: { enhance },
        store: {
          getEventById: jest.fn(() => cachedActivityWatchEvent)
        }
      }
    };
    setPluginStateFromMock(plugin);

    const events = await getCalendarEventsInRange(
      plugin as never,
      'aw',
      new Date('2026-04-14T00:00:00Z'),
      new Date('2026-04-15T00:00:00Z')
    );

    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe('session-1');
    expect(events[0].event.category).toBe('blue');
    expect(enhance).not.toHaveBeenCalled();
  });
});
