import { OFCEvent } from "../../Types";
import { StoredEvent } from '../EventStore';

export type CacheEntry = { event: OFCEvent; id: string; calendarId: string };

export type OFCEventSource = {
  events: CachedEvent[];
  editable: boolean;
  color: string;
  id: string;
};

export type CachedEvent = Pick<StoredEvent, 'event' | 'id'>;

export type UpdateViewCallback = (
  info:
    | {
        type: 'events';
        toRemove: string[];
        toAdd: CacheEntry[];
        affectedCalendars: string[];
      }
    | { type: 'calendar'; calendar: OFCEventSource }
    | { type: 'resync' }
) => void;
