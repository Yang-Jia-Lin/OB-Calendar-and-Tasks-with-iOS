import { PluginState } from "../../Core/PluginState";
import FullCalendarPlugin from '../../main';
import { AWBucket } from './api';
import {
  DerivedAWBlock,
  PriorCalendarEvent,
  ProfileSignature,
  ContinuityCandidate,
  SessionIndex
} from './sync-types';
import { SeedState } from './fsm';
import {
  CONTINUITY_BUFFER_MS,
  computeBoundedLookbackDurationMs,
  getCalendarEventsInRange,
  pickLatestEvent,
  isKnownActivityWatchProfileEvent,
  normalizeContinuityTitle,
  getProfileSignature,
  recoverSessionIdForPriorEvent,
  recoverSessionIdFromStore,
  coversPriorEventRange,
  materializeBlockAsEvent,
  findSwallowingExistingEvent,
  findExtendableExistingEvent,
  findReplaceableExistingEvents,
  extendEventEndIfNeeded,
  pickBestReconstructedBlockForPriorEvent
} from './sync-utils';

import { deriveActivityWatchBlocks, hasAwEvidenceAroundAnchorTime } from './sync-derive';
import { FullCalendarSettings } from "../../Types/settings";

export function findBoundaryOverlappingActivityWatchEvent(
  sessionIndex: SessionIndex,
  syncBoundaryMs: number
): PriorCalendarEvent | null {
  const candidates: PriorCalendarEvent[] = [];

  for (const bucket of sessionIndex.values()) {
    for (const prior of bucket) {
      const overlapsBoundary =
        prior.startMs <= syncBoundaryMs + CONTINUITY_BUFFER_MS &&
        prior.endMs >= syncBoundaryMs - CONTINUITY_BUFFER_MS;
      if (!overlapsBoundary) continue;

      if (!normalizeContinuityTitle(prior.cleanTitle)) continue;

      candidates.push(prior);
    }
  }

  candidates.sort((a, b) => b.endMs - a.endMs || b.startMs - a.startMs);
  return candidates[0] || null;
}

export async function findContinuityCandidate(
  plugin: FullCalendarPlugin,
  settings: FullCalendarSettings['activityWatch'],
  buckets: Record<string, AWBucket>,
  bucketIdsToFetch: Set<string>,
  profiles: NonNullable<FullCalendarSettings['activityWatch']['profiles']>,
  knownProfileSignatures: Set<ProfileSignature>
): Promise<ContinuityCandidate | null> {
  if (settings.syncStrategy === 'custom' || settings.lastSyncTime <= 0) {
    return null;
  }

  const lookbackMs = computeBoundedLookbackDurationMs(profiles);
  const boundaryStart = new Date(Math.max(0, settings.lastSyncTime - lookbackMs));
  const boundaryEnd = new Date(settings.lastSyncTime + CONTINUITY_BUFFER_MS);

  const candidates = await getCalendarEventsInRange(
    plugin,
    settings.targetCalendarId,
    boundaryStart,
    boundaryEnd
  );
  const latest = pickLatestEvent(candidates);
  if (!latest) {
    return null;
  }

  if (!isKnownActivityWatchProfileEvent(latest, knownProfileSignatures)) {
    return null;
  }
  if (!normalizeContinuityTitle(latest.cleanTitle)) {
    return null;
  }

  const reconstructedBlocks = await deriveActivityWatchBlocks(
    settings.apiUrl,
    buckets,
    bucketIdsToFetch,
    profiles,
    new Date(latest.startMs),
    new Date(latest.endMs)
  );
  const matchedBlock = pickBestReconstructedBlockForPriorEvent(reconstructedBlocks, latest);
  if (!matchedBlock) {
    return null;
  }

  const sameTitle =
    normalizeContinuityTitle(matchedBlock.title) === normalizeContinuityTitle(latest.cleanTitle);
  if (!sameTitle) {
    return null;
  }

  const hasSourceEvidence = await hasAwEvidenceAroundAnchorTime(
    settings.apiUrl,
    buckets,
    bucketIdsToFetch,
    latest.startMs,
    CONTINUITY_BUFFER_MS
  );
  if (!hasSourceEvidence) {
    return null;
  }

  return {
    priorEvent: latest
  };
}

export function buildSeedStateFromBoundaryEvent(
  profiles: NonNullable<FullCalendarSettings['activityWatch']['profiles']>,
  boundaryEvent: PriorCalendarEvent,
  boundaryMs: number
): {
  seedState: SeedState;
  matchedProfile: NonNullable<FullCalendarSettings['activityWatch']['profiles']>[number];
} | null {
  const matchedProfile = profiles.find(
    profile =>
      getProfileSignature(profile.name, profile.color) ===
      getProfileSignature(undefined, boundaryEvent.event.category || '')
  );

  if (!matchedProfile) return null;
  if ((matchedProfile.supportingEvidenceRules || []).length === 0) return null;

  const eventTitle = normalizeContinuityTitle(boundaryEvent.cleanTitle);
  if (!eventTitle) return null;

  const thresholdMs = matchedProfile.activationThresholdMins * 60 * 1000;

  return {
    seedState: {
      profileName: matchedProfile.name,
      profileColor: matchedProfile.color,
      state: 'active',
      sessionStartMs: boundaryEvent.startMs,
      lastEvidenceEndMs: boundaryMs,
      targetTimeMs: thresholdMs,
      fitnessScoreMs: 0
    },
    matchedProfile
  };
}

export async function createContinuityBlocksAndReplacePriorEvent(
  _plugin: FullCalendarPlugin,
  targetCalendarId: string,
  sessionIndex: SessionIndex,
  blocks: DerivedAWBlock[],
  priorEvent: PriorCalendarEvent,
  canDeleteExistingEvent: boolean,
  existingOverlapEvents: PriorCalendarEvent[],
  knownProfileSignatures: Set<ProfileSignature>
): Promise<number> {
  const sortedBlocks = [...blocks].sort((a, b) => a.startMs - b.startMs);

  if (!canDeleteExistingEvent) {
    return 0;
  }

  const hasSafeCoverage = coversPriorEventRange(sortedBlocks, priorEvent, CONTINUITY_BUFFER_MS);
  if (!hasSafeCoverage) {
    return 0;
  }

  const startThreshold = priorEvent.startMs - CONTINUITY_BUFFER_MS;
  const toDelete = existingOverlapEvents.filter(
    existing =>
      isKnownActivityWatchProfileEvent(existing, knownProfileSignatures) &&
      existing.startMs >= startThreshold
  );

  if (toDelete.length === 0) {
    console.error(
      'ActivityWatch continuity rewrite failed: detected a continuous session but found no prior ActivityWatch events to replace.',
      {
        priorEventTitle: priorEvent.event.title,
        priorEventStartMs: priorEvent.startMs,
        priorEventEndMs: priorEvent.endMs
      }
    );
    return 0;
  }

  const resolvedDeletes: string[] = [];
  for (const existing of toDelete) {
    let sessionId = existing.sessionId;
    if (!sessionId) {
      sessionId = recoverSessionIdForPriorEvent(sessionIndex, existing);
    }
    if (sessionId) {
      resolvedDeletes.push(sessionId);
    } else {
      console.error(
        'ActivityWatch continuity rewrite failed: detected a continuous session but could not resolve the prior event to a deletable session id.',
        {
          title: existing.event.title,
          category: existing.event.category,
          startMs: existing.startMs,
          endMs: existing.endMs,
          priorEventTitle: priorEvent.event.title,
          priorEventStartMs: priorEvent.startMs,
          priorEventEndMs: priorEvent.endMs
        }
      );
      return 0;
    }
  }

  for (const sessionId of resolvedDeletes) {
    try {
      await PluginState.getCache().deleteEvent(sessionId, { force: true,  });
    } catch (err) {
      console.error(
        'ActivityWatch continuity rewrite failed: detected a continuous session but could not delete the prior event before rewriting.',
        {
          sessionId,
          priorEventTitle: priorEvent.event.title,
          priorEventStartMs: priorEvent.startMs,
          priorEventEndMs: priorEvent.endMs,
          error: err
        }
      );
      console.warn('ActivityWatch sync: failed to delete overlapping continuity event.', err);
      return 0;
    }
  }

  const createdBlocks: DerivedAWBlock[] = [];
  let lastYieldTime = Date.now();

  for (const block of sortedBlocks) {
    const created = await PluginState.getCache().addEvent(
      targetCalendarId,
      materializeBlockAsEvent(block),
      {  }
    );
    if (created) {
      createdBlocks.push(block);
    }

    if (Date.now() - lastYieldTime > 16) {
      await new Promise(r => window.setTimeout(r, 0));
      lastYieldTime = Date.now();
    }
  }

  return createdBlocks.length;
}

export async function createOrUpdateBlock(
  plugin: FullCalendarPlugin,
  targetCalendarId: string,
  sessionIndex: SessionIndex,
  block: DerivedAWBlock,
  existingOverlapEvents: PriorCalendarEvent[],
  canExtendExistingEvents: boolean,
  canReplaceExistingEvents: boolean,
  knownProfileSignatures: Set<ProfileSignature>
): Promise<'ignored' | 'extended' | 'created'> {
  const swallowing = findSwallowingExistingEvent(existingOverlapEvents, block);
  if (swallowing) {
    return 'ignored';
  }

  if (canExtendExistingEvents) {
    const extendable = findExtendableExistingEvent(existingOverlapEvents, block);
    if (extendable) {
      let sessionId = extendable.sessionId;

      if (!sessionId) {
        sessionId = recoverSessionIdFromStore(sessionIndex, block);
      }

      if (sessionId) {
        const didExtend = await extendEventEndIfNeeded(plugin, sessionId, block.endMs);
        if (didExtend) {
          extendable.sessionId = sessionId;
          extendable.endMs = block.endMs;
          extendable.cleanTitle = block.title;
          extendable.event = {
            ...extendable.event,
            ...materializeBlockAsEvent(block),
            uid: extendable.event.uid
          };
          return 'extended';
        }
      }
    } else {
      const recoveredSessionId = recoverSessionIdFromStore(sessionIndex, block);

      if (recoveredSessionId) {
        const didExtend = await extendEventEndIfNeeded(plugin, recoveredSessionId, block.endMs);
        if (didExtend) {
          return 'extended';
        }
      }
    }
  }

  if (canReplaceExistingEvents) {
    const replaceableEvents = findReplaceableExistingEvents(
      existingOverlapEvents,
      block,
      knownProfileSignatures
    );

    for (const existing of replaceableEvents) {
      let sessionId = existing.sessionId;
      if (!sessionId) {
        sessionId = recoverSessionIdForPriorEvent(sessionIndex, existing);
      }

      if (!sessionId) continue;

      try {
        await PluginState.getCache().deleteEvent(sessionId, {
          force: true,

        });
        existing.sessionId = sessionId;

        const idx = existingOverlapEvents.indexOf(existing);
        if (idx >= 0) {
          existingOverlapEvents.splice(idx, 1);
        }
      } catch (err) {
        console.warn('ActivityWatch sync: failed to replace stale continuity event.', err);
      }
    }
  }

  const ofcEvent = materializeBlockAsEvent(block);
  const created = await PluginState.getCache().addEvent(targetCalendarId, ofcEvent, {

  });

  if (created) {
    const recoveredCreatedSessionId = recoverSessionIdFromStore(sessionIndex, block);
    existingOverlapEvents.push({
      sessionId: recoveredCreatedSessionId,
      calendarId: targetCalendarId,
      cleanTitle: block.title,
      event: ofcEvent,
      startMs: block.startMs,
      endMs: block.endMs
    });

    return 'created';
  }

  return 'ignored';
}
