import { CacheSubscriptionManager } from './CacheSubscriptionManager';

describe('CacheSubscriptionManager', () => {
  it('flushes updates queued through an existing queue reference', () => {
    const manager = new CacheSubscriptionManager();
    const updateCallback = jest.fn();
    manager.on('update', updateCallback);

    const queuedRef = manager.updateQueue;
    queuedRef.toRemove.add('child-event-id');
    queuedRef.toAdd.set('master-event-id', {
      id: 'master-event-id',
      calendarId: 'local-calendar',
      event: {
        type: 'recurring',
        title: 'Master Event',
        allDay: true,
        skipDates: ['2026-05-15'],
        endDate: null
      }
    });

    manager.flushUpdateQueue([], []);

    expect(updateCallback).toHaveBeenCalledWith({
      type: 'events',
      toRemove: ['child-event-id'],
      toAdd: [
        {
          id: 'master-event-id',
          calendarId: 'local-calendar',
          event: {
            type: 'recurring',
            title: 'Master Event',
            allDay: true,
            skipDates: ['2026-05-15'],
            endDate: null
          }
        }
      ],
      affectedCalendars: ['local-calendar']
    });
    expect(manager.updateQueue).toBe(queuedRef);
    expect(manager.updateQueue.toRemove.size).toBe(0);
    expect(manager.updateQueue.toAdd.size).toBe(0);
  });
});
