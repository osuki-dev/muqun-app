import { describe, expect, test } from 'bun:test';

import { parseSimfarmDevices } from '@/lib/simfarm';
import { simfarmChromeNext, SIMFARM_CHROME_CLOSED } from '@/lib/simfarm-chrome';
import {
  clampSimfarmOffset,
  placeSimfarmFrame,
  simfarmContainsPoint,
  simfarmNormalizedPoint,
} from '@/lib/simfarm-frame';
import { SIMFARM_CHANNEL } from '@/lib/simfarm-protocol';
import { SimfarmSession } from '@/lib/simfarm-session';
import { SimfarmSessionCache } from '@/lib/simfarm-session-cache';
import { SimfarmTouchTracker } from '@/lib/simfarm-touch';

describe('simulator viewer coordinates', () => {
  test('fits a landscape tablet on a portrait phone without losing any edge', () => {
    const placed = placeSimfarmFrame({ width: 1366, height: 1024 }, { width: 400, height: 800 });
    expect(placed.x).toBe(0);
    expect(placed.width).toBe(400);
    expect(placed.y).toBeGreaterThan(0);
    expect(placed.y + placed.height).toBeLessThan(800);
    expect(simfarmContainsPoint({ x: 200, y: 20 }, placed)).toBe(false);
    expect(
      simfarmNormalizedPoint(
        { x: placed.x + placed.width * 0.75, y: placed.y + placed.height * 0.25 },
        placed
      )
    ).toEqual({ x: 0.75, y: 0.25 });
  });

  test('keeps input aligned with the drawn rectangle after zoom and pan', () => {
    const viewport = { width: 400, height: 800 };
    const frame = { width: 1024, height: 1366 };
    const enlarged = placeSimfarmFrame(frame, viewport, 3);
    const offset = clampSimfarmOffset(enlarged, viewport, { x: -1000, y: 1000 });
    const placed = placeSimfarmFrame(frame, viewport, 3, offset);
    const point = { x: 200, y: 400 };
    const normalized = simfarmNormalizedPoint(point, placed);
    expect(placed.x + normalized.x * placed.width).toBeCloseTo(point.x);
    expect(placed.y + normalized.y * placed.height).toBeCloseTo(point.y);
    const reset = placeSimfarmFrame(frame, viewport);
    expect(reset.width).toBeLessThanOrEqual(viewport.width);
    expect(reset.height).toBeLessThanOrEqual(viewport.height);
  });
});

test('the action button switches a device picker directly to actions without another tap', () => {
  const picking = simfarmChromeNext(SIMFARM_CHROME_CLOSED, 'offer');
  const actions = simfarmChromeNext(picking, 'button');
  expect(actions).toMatchObject({ menu: true, picking: false });
  expect(simfarmChromeNext(actions, 'offer')).toMatchObject({ menu: true, picking: true });
});

test('quick taps keep a complete HID pulse and a two-finger gesture never becomes remote input', () => {
  const jobs = new Map<() => void, number>();
  const tracker = new SimfarmTouchTracker(
    (run, delay) => {
      jobs.set(run, delay);
      return () => {
        jobs.delete(run);
      };
    },
    () => 0
  );
  const runDelay = (delay: number) => {
    for (const [run, scheduled] of [...jobs]) {
      if (scheduled !== delay) continue;
      jobs.delete(run);
      run();
    }
  };
  const placed = placeSimfarmFrame({ width: 100, height: 100 }, { width: 100, height: 200 });
  const phases: number[] = [];
  const forward = (phase: number) => {
    phases.push(phase);
  };
  tracker.down({ x: 50, y: 70 }, 1, placed, forward);
  tracker.up({ x: 50, y: 70 }, 0, forward);
  expect(phases).toEqual([0]);
  runDelay(32);
  expect(phases).toEqual([0, 2]);
  phases.length = 0;
  tracker.down({ x: 50, y: 70 }, 1, placed, forward);
  tracker.down({ x: 60, y: 90 }, 2, placed, forward);
  tracker.up({ x: 60, y: 90 }, 1, forward);
  tracker.move({ x: 70, y: 110 }, 1, forward);
  tracker.up({ x: 70, y: 110 }, 0, forward);
  expect(phases).toEqual([]);
  tracker.down({ x: 50, y: 70 }, 1, placed, forward);
  tracker.cancel(forward);
  expect(phases).toEqual([]);
  tracker.down({ x: 50, y: 70 }, 1, placed, forward);
  runDelay(75);
  tracker.cancel(forward);
  expect(phases).toEqual([0, 2]);
  phases.length = 0;
  tracker.down({ x: 50, y: 10 }, 1, placed, forward);
  tracker.up({ x: 50, y: 10 }, 0, forward);
  expect(phases).toEqual([]);
  expect(jobs.size).toBe(0);
});

const listedDevice = (rotate: boolean) => ({
  id: 'mock:tablet',
  name: 'Tablet',
  kind: 'mock',
  state: 'booted',
  screen: { width: 1024, height: 1366, scale: 2 },
  capabilities: { video: ['jpeg'], buttons: [], text: true, rotate },
});
const packet = (channel: number, body: unknown) => {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const bytes = new Uint8Array(json.length + 1);
  bytes[0] = channel;
  bytes.set(json, 1);
  return bytes;
};

test('rotation requires a real capability and waits for reported screen geometry', () => {
  for (const supported of [false, true]) {
    const raw = listedDevice(supported);
    const seed = parseSimfarmDevices({ devices: [raw] });
    const sent: Uint8Array[] = [];
    const session = new SimfarmSession({ seed, onFrame: () => {} });
    session.connect({ readyState: 1, send: (bytes) => sent.push(bytes), close: () => {} });
    session.select(raw.id);
    const attach = JSON.parse(new TextDecoder().decode(sent[0]?.subarray(1)));
    session.received(
      packet(SIMFARM_CHANNEL.CONTROL, { id: attach.id, ok: true, streamId: 4, device: raw })
    );
    const before = session.getState().screen;
    session.rotate();
    expect(sent.length).toBe(supported ? 2 : 1);
    expect(session.getState().screen).toEqual(before);
    if (supported) {
      const request = JSON.parse(new TextDecoder().decode(sent[1]?.subarray(1)));
      expect(request).toMatchObject({ op: 'rotate', streamId: 4, orientation: 'landscape_left' });
      session.received(
        packet(SIMFARM_CHANNEL.CONTROL, {
          id: request.id,
          ok: false,
          error: 'private server detail',
        })
      );
      expect(session.getState().error).toEqual({ kind: 'rotate-failed', detail: null });
    }
  }
});

test('explicit reconnect replaces the cached transport without breaking old release ownership', () => {
  let opened = 0;
  let closed = 0;
  const cache = new SimfarmSessionCache({
    schedule: () => () => {},
    open: (_url, session) => {
      opened += 1;
      session.connect({
        readyState: 1,
        send: () => {},
        close: () => {
          closed += 1;
        },
      });
    },
  });
  const old = cache.acquire('ws://fixture/v1');
  cache.reconnect('ws://fixture/v1');
  const fresh = cache.acquire('ws://fixture/v1');
  old.release();
  expect(fresh.entry).not.toBe(old.entry);
  expect(opened).toBe(2);
  expect(closed).toBe(1);
  expect(cache.size).toBe(1);
  fresh.release();
  cache.closeIdle();
  expect(closed).toBe(2);
});
