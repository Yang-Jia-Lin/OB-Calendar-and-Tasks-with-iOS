import { PluginState } from "../../Core/PluginState";
import { FullCalendarSettings } from "../../Types/settings";
import FullCalendarPlugin from '../../main';
import { OFCEvent } from "../../Types";
import { moment as obsidianMoment } from 'obsidian';
import {
  DerivedAWBlock,
  PriorCalendarEvent,
  ProfileSignature,
  TimeRange,
  SessionIndex
} from './sync-types';

interface MinimalMoment {
  format(fmt?: string): string;
  valueOf(): number;
  isValid(): boolean;
}
const moment = obsidianMoment as unknown as (
  input?: unknown,
  format?: string,
  strict?: boolean
) => MinimalMoment;
export const CONTINUITY_BUFFER_MS = 60 * 1000;
export const LOOKBACK_SAFETY_BUFFER_MINS = 5;
export const MIN_SYNC_LOOKBACK_MINS = 30;
export const MAX_SYNC_LOOKBACK_MINS = 6 * 60;

export function parseTimedSingleEventRange(
  event: OFCEvent
): { startMs: number; endMs: number } | null {
  if (event.type !== 'single' || event.allDay) return null;
  if (!event.startTime || !event.endTime) return null;

  const startMoment = moment(`${event.date} ${event.startTime}`, 'YYYY-MM-DD HH:mm', true);
  const endBaseDate = event.endDate || event.date;
  const endMoment = moment(`${endBaseDate} ${event.endTime}`, 'YYYY-MM-DD HH:mm', true);

  if (!startMoment.isValid() || !endMoment.isValid()) return null;

  const startMs = startMoment.valueOf();
  let endMs = endMoment.valueOf();
  if (endMs <= startMs) {
    endMs += 24 * 60 * 60 * 1000;
  }

  return { startMs, endMs };
}

export function computeLookbackDurationMs(
  profiles: NonNullable<FullCalendarSettings['activityWatch']['profiles']>
): number {
  const maxActivationThresholdMins = profiles.reduce(
    (max, profile) => Math.max(max, profile.activationThresholdMins || 0),
    0
  );
  const maxSoftBreakLimitMins = profiles.reduce(
    (max, profile) => Math.max(max, profile.softBreakLimitMins || 0),
    0
  );

  return (
    (maxActivationThresholdMins + maxSoftBreakLimitMins + LOOKBACK_SAFETY_BUFFER_MINS) * 60 * 1000
  );
}

export function pickLatestEvent(events: PriorCalendarEvent[]): PriorCalendarEvent | null {
  if (events.length === 0) return null;
  return events.reduce((latest, candidate) => {
    if (candidate.endMs !== latest.endMs) {
      return candidate.endMs > latest.endMs ? candidate : latest;
    }
    return candidate.startMs > latest.startMs ? candidate : latest;
  });
}

export function computeOverlapMs(left: TimeRange, right: TimeRange): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

export function pickBestReconstructedBlockForPriorEvent(
  blocks: DerivedAWBlock[],
  priorEvent: PriorCalendarEvent
): DerivedAWBlock | null {
  if (blocks.length === 0) return null;

  const priorRange = { startMs: priorEvent.startMs, endMs: priorEvent.endMs };

  const exactProfileMatches = blocks.filter(
    block => block.profileColor === priorEvent.event.category
  );
  const candidates = exactProfileMatches.length > 0 ? exactProfileMatches : blocks;

  return candidates.reduce((best, candidate) => {
    const bestOverlap = computeOverlapMs(priorRange, { startMs: best.startMs, endMs: best.endMs });
    const candidateOverlap = computeOverlapMs(priorRange, {
      startMs: candidate.startMs,
      endMs: candidate.endMs
    });

    if (candidateOverlap !== bestOverlap) {
      return candidateOverlap > bestOverlap ? candidate : best;
    }

    const bestDistance = Math.abs(best.startMs - priorEvent.startMs);
    const candidateDistance = Math.abs(candidate.startMs - priorEvent.startMs);
    return candidateDistance < bestDistance ? candidate : best;
  });
}

export function computeBoundedLookbackDurationMs(
  profiles: NonNullable<FullCalendarSettings['activityWatch']['profiles']>,
  matchedProfile?: NonNullable<FullCalendarSettings['activityWatch']['profiles']>[number]
): number {
  const baseLookbackMs = matchedProfile
    ? (matchedProfile.activationThresholdMins +
        matchedProfile.softBreakLimitMins +
        LOOKBACK_SAFETY_BUFFER_MINS) *
      60 *
      1000
    : computeLookbackDurationMs(profiles);
  const minLookbackMs = MIN_SYNC_LOOKBACK_MINS * 60 * 1000;
  const maxLookbackMs = MAX_SYNC_LOOKBACK_MINS * 60 * 1000;
  return Math.min(maxLookbackMs, Math.max(baseLookbackMs, minLookbackMs));
}

export function isSameProfileBlock(existing: PriorCalendarEvent, block: DerivedAWBlock): boolean {
  return existing.event.category === block.profileColor;
}

export function getProfileSignature(
  _profileName: string | null | undefined,
  profileColor: string | null | undefined
): ProfileSignature {
  return `${profileColor || ''}`;
}

export function normalizeContinuityTitle(title: string | null | undefined): string {
  return (title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isSameContinuityBlock(
  existing: PriorCalendarEvent,
  block: DerivedAWBlock
): boolean {
  return (
    isSameProfileBlock(existing, block) &&
    normalizeContinuityTitle(existing.cleanTitle) === normalizeContinuityTitle(block.title)
  );
}

export function isKnownActivityWatchProfileEvent(
  existing: PriorCalendarEvent,
  knownProfileSignatures: Set<ProfileSignature>
): boolean {
  return knownProfileSignatures.has(getProfileSignature(undefined, existing.event.category || ''));
}

export async function getCalendarEventsInRange(
  _plugin: FullCalendarPlugin,
  targetCalendarId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<PriorCalendarEvent[]> {
  if (rangeEnd.getTime() <= rangeStart.getTime()) return [];

  const calendarInstance = PluginState.getProviderRegistry().getInstance(targetCalendarId);
  if (!calendarInstance) return [];

  const providerEvents = await calendarInstance.getEvents({ start: rangeStart, end: rangeEnd });
  const candidates: PriorCalendarEvent[] = [];

  for (const [rawEvent] of providerEvents) {
    const globalIdentifier = PluginState.getProviderRegistry().getGlobalIdentifier(
      rawEvent,
      targetCalendarId
    );
    const sessionId = globalIdentifier
      ? await PluginState.getProviderRegistry().getSessionId(globalIdentifier)
      : null;
    const cachedEvent = sessionId ? PluginState.getCache().store.getEventById(sessionId) : null;
    const event = cachedEvent || PluginState.getCache().enhancer.enhance(rawEvent);

    const eventRange = parseTimedSingleEventRange(event);
    if (!eventRange) continue;

    if (eventRange.endMs < rangeStart.getTime() - CONTINUITY_BUFFER_MS) continue;
    if (eventRange.startMs > rangeEnd.getTime() + CONTINUITY_BUFFER_MS) continue;

    candidates.push({
      sessionId,
      calendarId: targetCalendarId,
      cleanTitle: PluginState.getProviderRegistry().getCanonicalTitle(event, targetCalendarId),
      event,
      startMs: eventRange.startMs,
      endMs: eventRange.endMs
    });
  }

  return candidates.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export async function extendEventEndIfNeeded(
  _plugin: FullCalendarPlugin,
  eventId: string,
  newEndMs: number
): Promise<boolean> {
  const details = PluginState.getCache().store.getEventDetails(eventId);
  if (!details) return false;

  const existingRange = parseTimedSingleEventRange(details.event);
  if (!existingRange) return false;
  if (newEndMs <= existingRange.endMs) return false;

  const event = details.event;
  if (event.type !== 'single' || event.allDay || !event.startTime) {
    return false;
  }

  const endMoment = moment(newEndMs);
  const newEndDate = endMoment.format('YYYY-MM-DD');
  const updatedEvent: OFCEvent = {
    ...event,
    endTime: endMoment.format('HH:mm'),
    endDate: newEndDate !== event.date ? newEndDate : null
  };

  return PluginState.getCache().updateEventWithId(eventId, updatedEvent);
}

export function findSwallowingExistingEvent(
  existingEvents: PriorCalendarEvent[],
  block: DerivedAWBlock
): PriorCalendarEvent | null {
  return (
    existingEvents.find(
      existing =>
        isSameContinuityBlock(existing, block) &&
        existing.startMs <= block.startMs + CONTINUITY_BUFFER_MS &&
        existing.endMs >= block.endMs - CONTINUITY_BUFFER_MS
    ) || null
  );
}

export function findExtendableExistingEvent(
  existingEvents: PriorCalendarEvent[],
  block: DerivedAWBlock
): PriorCalendarEvent | null {
  const extendableCandidates = existingEvents.filter(
    existing =>
      isSameContinuityBlock(existing, block) &&
      existing.endMs >= block.startMs - CONTINUITY_BUFFER_MS &&
      existing.startMs <= block.endMs + CONTINUITY_BUFFER_MS &&
      block.endMs > existing.endMs + CONTINUITY_BUFFER_MS
  );

  if (extendableCandidates.length === 0) {
    return null;
  }

  return extendableCandidates.reduce((latest, candidate) =>
    candidate.endMs > latest.endMs ? candidate : latest
  );
}

export function findReplaceableExistingEvents(
  existingEvents: PriorCalendarEvent[],
  block: DerivedAWBlock,
  knownProfileSignatures: Set<ProfileSignature>
): PriorCalendarEvent[] {
  return existingEvents.filter(
    existing =>
      isKnownActivityWatchProfileEvent(existing, knownProfileSignatures) &&
      !isSameContinuityBlock(existing, block) &&
      existing.endMs >= block.startMs - CONTINUITY_BUFFER_MS &&
      existing.startMs <= block.endMs + CONTINUITY_BUFFER_MS
  );
}

export function buildSessionIndex(
  _plugin: FullCalendarPlugin,
  targetCalendarId: string,
  knownProfileSignatures: Set<ProfileSignature>
): SessionIndex {
  const index = new Map<ProfileSignature, PriorCalendarEvent[]>();

  const allEvents = PluginState.getCache().store.getAllEvents();
  for (const stored of allEvents) {
    if (stored.calendarId !== targetCalendarId) continue;

    const range = parseTimedSingleEventRange(stored.event);
    if (!range) continue;

    const sig = getProfileSignature(undefined, stored.event.category);
    if (!knownProfileSignatures.has(sig)) continue;

    let bucket = index.get(sig);
    if (!bucket) {
      bucket = [];
      index.set(sig, bucket);
    }
    bucket.push({
      sessionId: stored.id,
      calendarId: targetCalendarId,
      cleanTitle: PluginState.getProviderRegistry().getCanonicalTitle(
        stored.event,
        targetCalendarId
      ),
      event: stored.event,
      startMs: range.startMs,
      endMs: range.endMs
    });
  }

  for (const bucket of index.values()) {
    bucket.sort((a, b) => b.endMs - a.endMs || b.startMs - a.startMs);
  }

  return index;
}

export function recoverSessionIdFromStore(
  sessionIndex: SessionIndex,
  block: DerivedAWBlock
): string | null {
  const sig = getProfileSignature(block.profileName, block.profileColor);
  const candidates = sessionIndex.get(sig);
  if (!candidates) return null;

  const matches = candidates.filter(existing => {
    const sameTitle =
      normalizeContinuityTitle(existing.cleanTitle) === normalizeContinuityTitle(block.title);
    const overlaps =
      existing.endMs >= block.startMs - CONTINUITY_BUFFER_MS &&
      existing.startMs <= block.endMs + CONTINUITY_BUFFER_MS;

    return sameTitle && overlaps;
  });

  return matches[0]?.sessionId || null;
}

export function recoverSessionIdForPriorEvent(
  sessionIndex: SessionIndex,
  existingEvent: PriorCalendarEvent
): string | null {
  const sig = getProfileSignature(undefined, existingEvent.event.category);
  const candidates = sessionIndex.get(sig);
  if (!candidates) return null;

  const matches = candidates.filter(existing => {
    const sameTitle =
      normalizeContinuityTitle(existing.cleanTitle) ===
      normalizeContinuityTitle(existingEvent.cleanTitle);
    const nearSameRange =
      Math.abs(existing.startMs - existingEvent.startMs) <= CONTINUITY_BUFFER_MS &&
      Math.abs(existing.endMs - existingEvent.endMs) <= CONTINUITY_BUFFER_MS;

    return sameTitle && nearSameRange;
  });

  return matches[0]?.sessionId || null;
}

export function materializeBlockAsEvent(block: DerivedAWBlock): OFCEvent {
  const startMoment = moment(block.startMs);
  const endMoment = moment(block.endMs);

  return {
    type: 'single',
    title: block.title,
    category: block.profileColor,
    date: startMoment.format('YYYY-MM-DD'),
    endDate: null,
    allDay: false,
    startTime: startMoment.format('HH:mm'),
    endTime: endMoment.format('HH:mm'),
    display: 'auto'
  };
}

export function coversPriorEventRange(
  blocks: DerivedAWBlock[],
  priorEvent: PriorCalendarEvent,
  bufferMs: number
): boolean {
  if (blocks.length === 0) return false;

  const clipped = blocks
    .map(block => ({
      startMs: Math.max(block.startMs, priorEvent.startMs),
      endMs: Math.min(block.endMs, priorEvent.endMs)
    }))
    .filter(range => range.endMs > range.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  if (clipped.length === 0) return false;

  let coveredMs = 0;
  let currentStart = clipped[0].startMs;
  let currentEnd = clipped[0].endMs;

  for (let i = 1; i < clipped.length; i++) {
    const next = clipped[i];
    if (next.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, next.endMs);
    } else {
      coveredMs += currentEnd - currentStart;
      currentStart = next.startMs;
      currentEnd = next.endMs;
    }
  }
  coveredMs += currentEnd - currentStart;

  const expectedMs = priorEvent.endMs - priorEvent.startMs;
  if (expectedMs <= 0) return false;

  return coveredMs >= Math.max(0, expectedMs - bufferMs);
}
