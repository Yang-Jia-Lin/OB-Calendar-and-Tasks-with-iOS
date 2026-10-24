import { requestUrl } from 'obsidian';
import { AWBucket, AWEvent } from './api';
import { executeFSM, FinalBlock, CompoundEvent, AWNode, SeedState } from './fsm';
import { DerivedAWBlock, TimeRange, BucketEvent, BucketKinds } from './sync-types';
import { FullCalendarSettings } from "../../Types/settings";

export const COMMON_BROWSER_APP_PATTERN =
  /(firefox|chrome|chromium|edge|brave|opera|vivaldi|arc|safari|librewolf|waterfox|floorp|zen|whale|tor)/i;

export function deriveOutputTitle(block: FinalBlock): string {
  let outputTitle = block.profile.titleTemplate || '{app}';

  const dataDurationMap = new Map<string, { duration: number; data: Record<string, unknown> }>();
  const titleEvidenceSplinters =
    block.primaryEvidenceSplinters.length > 0
      ? block.primaryEvidenceSplinters
      : block.splintersInside;

  for (const s of titleEvidenceSplinters) {
    const dur = Math.min(s.endMs, block.endMs) - Math.max(s.startMs, block.startMs);
    const key = JSON.stringify(s.data);
    const existing = dataDurationMap.get(key) || { duration: 0, data: s.data };
    existing.duration += dur;
    dataDurationMap.set(key, existing);
  }

  let majorData: Record<string, unknown> = {};
  let maxDur = -1;
  for (const val of dataDurationMap.values()) {
    if (val.duration > maxDur) {
      maxDur = val.duration;
      majorData = val.data;
    }
  }

  for (const key of Object.keys(majorData)) {
    const v = majorData[key];
    const strVal = typeof v === 'string' ? v : v ? JSON.stringify(v) : '';
    outputTitle = outputTitle.replaceAll(`{${key}}`, strVal);
  }

  outputTitle = outputTitle.replace(/\{[^}]+\}/g, '').trim();
  if (!outputTitle || outputTitle === '-' || outputTitle === '|') {
    outputTitle = block.profile.name;
  }

  return outputTitle;
}

export async function deriveActivityWatchBlocks(
  apiUrl: string,
  buckets: Record<string, AWBucket>,
  bucketIdsToFetch: Set<string>,
  profiles: NonNullable<FullCalendarSettings['activityWatch']['profiles']>,
  startTime: Date,
  endTime: Date,
  seedStates: SeedState[] = []
): Promise<DerivedAWBlock[]> {
  if (endTime.getTime() <= startTime.getTime()) {
    return [];
  }

  const startTimeISO = startTime.toISOString();
  const endTimeISO = endTime.toISOString();

  const fetchEvents = async (bucketId: string): Promise<AWEvent[]> => {
    const resp = await requestUrl(
      `${apiUrl}/api/0/buckets/${bucketId}/events?start=${startTimeISO}&end=${endTimeISO}`
    );
    return resp.json as AWEvent[];
  };

  const getEventRange = (event: AWEvent): TimeRange => {
    const startMs = new Date(event.timestamp).getTime();
    return {
      startMs,
      endMs: startMs + event.duration * 1000
    };
  };

  const bucketEventsById = new Map<string, BucketEvent[]>();
  for (const bId of bucketIdsToFetch) {
    const bObj = buckets[bId] || Object.values(buckets).find(b => b.id === bId);
    if (!bObj) continue;

    const events = await fetchEvents(bId);

    const kinds: BucketKinds = {
      isWeb: bObj.type === 'web.tab.current' || bObj.id.includes('web'),
      isAfk: bObj.type === 'afk' || bObj.id.includes('afk'),
      isWindow: bObj.type === 'currentwindow' || bObj.id.includes('window')
    };

    const normalizedEvents: BucketEvent[] = [];
    for (const event of events) {
      if (kinds.isAfk && event.data?.status === 'not-afk') {
        continue;
      }

      const range = getEventRange(event);
      if (range.endMs <= range.startMs) continue;

      normalizedEvents.push({
        range,
        data: event.data || {},
        bucketType: bObj.type,
        kinds
      });
    }

    bucketEventsById.set(bId, normalizedEvents);
  }

  const allNormalizedEvents: BucketEvent[] = [];
  for (const bId of bucketIdsToFetch) {
    const events = bucketEventsById.get(bId) || [];
    for (const ev of events) {
      allNormalizedEvents.push(ev);
    }
  }

  // Collect all unique time boundaries
  const boundaries = new Set<number>();
  for (const e of allNormalizedEvents) {
    boundaries.add(e.range.startMs);
    boundaries.add(e.range.endMs);
  }
  const sortedBounds = Array.from(boundaries).sort((a, b) => a - b);
  const compoundSlices: CompoundEvent[] = [];

  for (let i = 0; i < sortedBounds.length - 1; i++) {
    const sliceStart = sortedBounds[i];
    const sliceEnd = sortedBounds[i + 1];
    if (sliceStart >= sliceEnd) continue;

    let hasBrowserWindow = false;
    for (const ev of allNormalizedEvents) {
      if (ev.range.startMs <= sliceStart && ev.range.endMs >= sliceEnd) {
        if (ev.kinds.isWindow) {
          const app = typeof ev.data?.app === 'string' ? ev.data.app : '';
          if (COMMON_BROWSER_APP_PATTERN.test(app)) {
            hasBrowserWindow = true;
            break;
          }
        }
      }
    }

    const activeStates: AWNode[] = [];
    for (const ev of allNormalizedEvents) {
      if (ev.range.startMs <= sliceStart && ev.range.endMs >= sliceEnd) {
        if (ev.kinds.isWeb && !hasBrowserWindow) {
          continue; // Web bucket states are strictly dependent on an active browser window
        }
        activeStates.push({
          bucketType: ev.bucketType,
          data: ev.data
        });
      }
    }

    if (activeStates.length > 0) {
      compoundSlices.push({
        startMs: sliceStart,
        endMs: sliceEnd,
        states: activeStates
      });
    }
  }

  const finalBlocks = executeFSM(compoundSlices, profiles, seedStates);
  return finalBlocks.map(block => ({
    startMs: block.startMs,
    endMs: block.endMs,
    title: deriveOutputTitle(block),
    profileColor: block.profile.color,
    profileName: block.profile.name
  }));
}

export async function hasAwEvidenceAroundAnchorTime(
  apiUrl: string,
  buckets: Record<string, AWBucket>,
  bucketIdsToFetch: Set<string>,
  anchorMs: number,
  bufferMs: number
): Promise<boolean> {
  const start = new Date(Math.max(0, anchorMs - bufferMs)).toISOString();
  const end = new Date(anchorMs + bufferMs).toISOString();

  for (const bucketId of bucketIdsToFetch) {
    const bucket = buckets[bucketId] || Object.values(buckets).find(b => b.id === bucketId);
    if (!bucket) continue;

    const isAwBucketKind =
      bucket.type === 'currentwindow' ||
      bucket.type === 'web.tab.current' ||
      bucket.type === 'afk' ||
      bucket.id.includes('window') ||
      bucket.id.includes('web') ||
      bucket.id.includes('afk');
    if (!isAwBucketKind) continue;

    try {
      const resp = await requestUrl(
        `${apiUrl}/api/0/buckets/${bucket.id}/events?start=${start}&end=${end}`
      );
      const events = resp.json as AWEvent[];

      for (const event of events) {
        if (bucket.type === 'afk' && event.data?.status === 'not-afk') continue;

        const startMs = new Date(event.timestamp).getTime();
        const endMs = startMs + event.duration * 1000;
        if (endMs <= startMs) continue;

        if (endMs >= anchorMs - bufferMs && startMs <= anchorMs + bufferMs) {
          return true;
        }
      }
    } catch {
      // Safety-first: if evidence probing fails, continuity rewrite should not run.
      return false;
    }
  }

  return false;
}
