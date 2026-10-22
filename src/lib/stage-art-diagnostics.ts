import { useSyncExternalStore } from 'react';
import { createMMKV } from 'react-native-mmkv';
import { Skia } from 'react-native-skia';

import {
  appendStageArtEvent,
  parseStageArtLog,
  stageArtErrorText,
  stageArtFileName,
  STAGE_ART_RETRIES,
  type StageArtEvent,
  type StageArtSlot,
  type StageArtStatus,
  type StageArtStep,
} from '@/lib/stage-art-log';

/**
 * The Stage's art log (`stage-art-log.ts`), kept in memory and in MMKV so it
 * survives the restart a reader tries first, plus the session's retry state:
 * how often each picture has failed, and an epoch that moves when Home comes
 * back with failures to try again. Read from Settings (long-press the
 * version) as "Stage diagnostics".
 *
 * Nothing here throws: a log that cannot be written is a log that is shorter.
 */

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.diagnostics';
const STORAGE_KEY = 'muqun.home-stage.art-log';

let storageInstance: KeyValueStore | null = null;
function store(): KeyValueStore | null {
  if (storageInstance) return storageInstance;
  try {
    storageInstance = createMMKV({ id: STORE_ID });
  } catch {
    return null;
  }
  return storageInstance;
}

let events: StageArtEvent[] | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function current(): StageArtEvent[] {
  if (events === null) {
    try {
      events = parseStageArtLog(store()?.getString(STORAGE_KEY));
    } catch {
      events = [];
    }
  }
  return events;
}

const context: { theme?: string; quality?: string } = {};

/** The theme and quality rung later events are stamped with. */
export function setStageArtContext(next: { theme?: string; quality?: string }): void {
  context.theme = next.theme;
  context.quality = next.quality;
}

/**
 * Why Skia has no GPU device -- lost since launch, or never available -- or
 * null while it has one. While it has none nothing Skia draws on screen
 * appears, the Stage's WebGPU scene included, until the app restarts.
 */
export function skiaGpuLostReason(): string | null {
  try {
    const gpu = Skia.gpu;
    if (!gpu || gpu.isAvailable) return null;
    return gpu.error || 'Skia has no GPU device';
  } catch {
    return null;
  }
}

export type StageArtRecord = {
  slot: StageArtSlot;
  step: StageArtStep;
  status: StageArtStatus;
  uri?: string;
  width?: number;
  height?: number;
  maxEdge?: number;
  attempt?: number;
  error?: unknown;
};

export function recordStageArtEvent(record: StageArtRecord): void {
  const event: StageArtEvent = {
    at: Date.now(),
    slot: record.slot,
    step: record.step,
    status: record.status,
    theme: context.theme,
    file: stageArtFileName(record.uri),
    size:
      record.width && record.height
        ? `${Math.round(record.width)}x${Math.round(record.height)}`
        : undefined,
    maxEdge: record.maxEdge,
    attempt: record.attempt,
    quality: context.quality,
    gpuLost: skiaGpuLostReason() !== null,
    error: stageArtErrorText(record.error),
  };
  events = appendStageArtEvent(current(), event);
  try {
    store()?.set(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Kept in memory for this session.
  }
  notify();
}

export function clearStageArtEvents(): void {
  events = [];
  try {
    store()?.set(STORAGE_KEY, '[]');
  } catch {
    // See above.
  }
  notify();
}

/** The log, oldest first. */
export function useStageArtEvents(): readonly StageArtEvent[] {
  return useSyncExternalStore(subscribe, current, current);
}

// Retries ---------------------------------------------------------------------

const failures = new Map<string, number>();
/** Pictures that failed and have tries left, waiting for Home to come back. */
const waiting = new Map<string, { slot: StageArtSlot; step: StageArtStep }>();
let epoch = 0;
const epochListeners = new Set<() => void>();
const subscribeEpoch = (listener: () => void) => {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
};
const readEpoch = () => epoch;

export const currentStageArtEpoch = readEpoch;

/** Moves when Home returns with failed pictures to try again. */
export function useStageArtEpoch(): number {
  return useSyncExternalStore(subscribeEpoch, readEpoch, readEpoch);
}

/**
 * Count a failure of the picture at `uri` and log it; returns the failures so
 * far this session. Past the retry budget it is logged as given up.
 */
export function noteStageArtFailure(
  record: Omit<StageArtRecord, 'status'> & { uri: string }
): number {
  const count = (failures.get(record.uri) ?? 0) + 1;
  failures.set(record.uri, count);
  const exhausted = count > STAGE_ART_RETRIES;
  if (exhausted) waiting.delete(record.uri);
  else waiting.set(record.uri, { slot: record.slot, step: record.step });
  recordStageArtEvent({ ...record, status: exhausted ? 'gave-up' : 'failed', attempt: count });
  return count;
}

/** Home is on screen again: pictures that failed get their next try. */
export function retryStageArt(): void {
  if (waiting.size === 0) return;
  for (const [uri, { slot, step }] of waiting)
    recordStageArtEvent({
      slot,
      step,
      status: 'retry',
      uri,
      attempt: failures.get(uri),
    });
  waiting.clear();
  epoch += 1;
  epochListeners.forEach((listener) => listener());
}

/** Skia's device is gone for this process: the Stage stays static until a restart. */
let gpuLost = false;
export function isStageGpuLost(): boolean {
  return gpuLost;
}

/**
 * After a GPU failure: whether Skia's device is lost (then the Stage stays
 * static for the session) -- logged either way, with the failure's message.
 */
export function noteStageGpuFailure(error: unknown, step: StageArtStep = 'render'): boolean {
  const lost = skiaGpuLostReason();
  if (lost !== null && !gpuLost) {
    gpuLost = true;
    recordStageArtEvent({ slot: 'stage', step: 'device', status: 'fallback', error: lost });
  }
  recordStageArtEvent({
    slot: 'stage',
    step,
    status: lost !== null ? 'fallback' : 'failed',
    error,
  });
  return gpuLost;
}

/** Check Skia's device without a failure in hand (Home coming back). */
export function checkStageGpuLost(): boolean {
  if (gpuLost) return true;
  const lost = skiaGpuLostReason();
  if (lost === null) return false;
  gpuLost = true;
  recordStageArtEvent({ slot: 'stage', step: 'device', status: 'fallback', error: lost });
  return true;
}

// What the Stage renders at -----------------------------------------------------

/** The Stage as it renders now, for the diagnostics sheet; null before Home has shown it. */
export type StageRenderInfo = {
  /** The rung drawn at, or `static` for the flat stage. */
  quality: string;
  /** Whether that rung is one being tried above the one held. */
  trial: boolean;
  /** The pixel ratio the scene renders at, and the device's own. */
  dpr: number;
  deviceScale: number;
  /** Each layer's texture as uploaded, `WxH`, under its cap in px. */
  textures: readonly { slot: string; size: string | null; cap: number }[];
};

let renderInfo: StageRenderInfo | null = null;
let renderInfoKey = '';
const renderListeners = new Set<() => void>();
const subscribeRender = (listener: () => void) => {
  renderListeners.add(listener);
  return () => {
    renderListeners.delete(listener);
  };
};
const readRenderInfo = () => renderInfo;

export function setStageRenderInfo(next: StageRenderInfo): void {
  const key = JSON.stringify(next);
  if (key === renderInfoKey) return;
  renderInfoKey = key;
  renderInfo = next;
  renderListeners.forEach((listener) => listener());
}

export function useStageRenderInfo(): StageRenderInfo | null {
  return useSyncExternalStore(subscribeRender, readRenderInfo, readRenderInfo);
}
