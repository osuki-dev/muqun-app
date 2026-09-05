// The sockets kept open after the preview closes.
//
// What is pinned is the lifetime: a released session survives for one grace
// period and is handed back whole -- open, attached, last frame and all -- to
// a screen that returns inside it; it is closed when the period runs out,
// when the app goes away, when the gateway changes, when another machine's
// session is opened, and the moment its transport drops. The socket is a
// fake that records what happened to it, the clock is a fake that fires when
// told, like the session's own tests.
import { describe, expect, test } from 'bun:test';

import { parseSimfarmDevices } from '@/lib/simfarm';
import { SIMFARM_CHANNEL, SIMFARM_VIDEO_TAG } from '@/lib/simfarm-protocol';
import { SimfarmSession, type SimfarmTransport } from '@/lib/simfarm-session';
import { SimfarmSessionCache } from '@/lib/simfarm-session-cache';

const RUNNING = {
  id: 'ios:running',
  name: 'iPhone 17 (iOS 26.5)',
  state: 'booted',
  screen: { width: 1206, height: 2622, scale: 3 },
  capabilities: { video: ['h264', 'jpeg'], text: true, buttons: ['home'], boot: true },
};

const URL_A = 'ws://mac.tailnet:8801/v1';
const URL_B = 'ws://other.tailnet:8801/v1';

class FakeSocket implements SimfarmTransport {
  readyState = 1;
  readonly sent: Uint8Array[] = [];
  closed = false;
  constructor(readonly session: SimfarmSession) {}
  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    // As a real socket does: closing reports back as dropped.
    this.session.dropped();
  }
  requests(): Record<string, unknown>[] {
    return this.sent
      .filter((bytes) => bytes[0] === SIMFARM_CHANNEL.CONTROL)
      .map((bytes) => JSON.parse(Buffer.from(bytes.subarray(1)).toString('utf8')));
  }
}

class FakeClock {
  private readonly pending = new Map<number, () => void>();
  private next = 1;
  schedule = (run: () => void, _ms: number): (() => void) => {
    const id = this.next++;
    this.pending.set(id, run);
    return () => {
      this.pending.delete(id);
    };
  };
  armed(): number {
    return this.pending.size;
  }
  elapse(): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const run of due) run();
  }
}

function json(channel: number, body: unknown): ArrayBuffer {
  return Uint8Array.from([channel, ...Buffer.from(JSON.stringify(body), 'utf8')]).buffer;
}
const devicesEvent = (devices: unknown[]) =>
  json(SIMFARM_CHANNEL.EVENT, { ev: 'devices', devices });
const reply = (body: Record<string, unknown>) => json(SIMFARM_CHANNEL.CONTROL, body);
const frame = (streamId: number, ...jpeg: number[]) =>
  Uint8Array.from([SIMFARM_CHANNEL.VIDEO, streamId, SIMFARM_VIDEO_TAG.KEY, ...jpeg]).buffer;

function harness() {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  const cache = new SimfarmSessionCache({
    open: (_url, session) => {
      const socket = new FakeSocket(session);
      sockets.push(socket);
      session.connect(socket);
      session.opened();
    },
    schedule: clock.schedule,
    graceMs: 60_000,
  });
  return { cache, clock, sockets };
}

/** Walk a session to `live` on the one running device. */
function goLive(session: SimfarmSession, streamId = 7) {
  session.received(devicesEvent([RUNNING]));
  session.received(reply({ id: 1, ok: true, streamId, device: RUNNING }));
  session.received(frame(streamId, 0xff, 0xd8, 0xff));
}

describe('holding', () => {
  test('the first hold opens one socket and a second hold on the same url shares it', () => {
    const { cache, sockets } = harness();
    const first = cache.acquire(URL_A);
    const second = cache.acquire(URL_A);
    expect(sockets).toHaveLength(1);
    expect(second.entry).toBe(first.entry);
    expect(cache.size).toBe(1);
  });

  test('a session is not idle while anyone holds it', () => {
    const { cache, clock } = harness();
    const hold = cache.acquire(URL_A);
    expect(cache.isIdle(URL_A)).toBe(false);
    expect(clock.armed()).toBe(0);
    hold.release();
    expect(cache.isIdle(URL_A)).toBe(true);
    expect(clock.armed()).toBe(1);
  });

  test('releasing twice counts once', () => {
    const { cache } = harness();
    const one = cache.acquire(URL_A);
    const two = cache.acquire(URL_A);
    one.release();
    one.release();
    expect(cache.isIdle(URL_A)).toBe(false);
    two.release();
    expect(cache.isIdle(URL_A)).toBe(true);
  });
});

describe('the grace period', () => {
  test('a released session is handed back whole to a screen that returns in time', () => {
    const { cache, clock, sockets } = harness();
    const first = cache.acquire(URL_A);
    goLive(first.entry.session);
    expect(first.entry.session.getState().status).toBe('live');
    expect(first.entry.lastFrame).toEqual(Uint8Array.from([0xff, 0xd8, 0xff]));

    first.release();
    expect(clock.armed()).toBe(1);
    const again = cache.acquire(URL_A);
    expect(again.entry).toBe(first.entry);
    expect(again.entry.session.getState().status).toBe('live');
    expect(again.entry.lastFrame).toEqual(Uint8Array.from([0xff, 0xd8, 0xff]));
    // Still the one socket, still attached: no detach was sent.
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
    expect(sockets[0].requests().map((r) => r.op)).toEqual(['attach']);
    // And the timer that would have closed it is gone.
    expect(clock.armed()).toBe(0);
  });

  test('a session nobody came back for is detached and closed when the period runs out', () => {
    const { cache, clock, sockets } = harness();
    const hold = cache.acquire(URL_A);
    goLive(hold.entry.session);
    hold.release();
    clock.elapse();
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].requests().map((r) => r.op)).toEqual(['attach', 'detach']);
    expect(cache.size).toBe(0);
    expect(hold.entry.lastFrame).toBeNull();
    // The next screen starts over on a new socket.
    const fresh = cache.acquire(URL_A);
    expect(sockets).toHaveLength(2);
    expect(fresh.entry).not.toBe(hold.entry);
  });

  test('the last frame is the newest one, and none once the stream was let go', () => {
    const { cache } = harness();
    const hold = cache.acquire(URL_A);
    const { session } = hold.entry;
    goLive(session);
    session.received(frame(7, 0xaa));
    expect(hold.entry.lastFrame).toEqual(Uint8Array.from([0xaa]));
    // Picking another device drops the stream and the picture with it.
    session.select('ios:other');
    expect(hold.entry.lastFrame).toBeNull();
  });

  test('a frame is kept as its own copy, not as a view on the message', () => {
    const { cache } = harness();
    const hold = cache.acquire(URL_A);
    goLive(hold.entry.session);
    const message = frame(7, 0x11, 0x22);
    hold.entry.session.received(message);
    new Uint8Array(message).fill(0);
    expect(hold.entry.lastFrame).toEqual(Uint8Array.from([0x11, 0x22]));
  });
});

describe('warming', () => {
  test('a warmed socket is the one the screen is handed, and is on its way to live meanwhile', () => {
    const { cache, clock, sockets } = harness();
    cache.warm(URL_A);
    expect(sockets).toHaveLength(1);
    expect(cache.isIdle(URL_A)).toBe(true);
    expect(clock.armed()).toBe(1);
    // The list arrives before the route has mounted; the attach goes out.
    sockets[0].session.received(devicesEvent([RUNNING]));
    expect(sockets[0].requests().map((r) => r.op)).toEqual(['attach']);

    const hold = cache.acquire(URL_A);
    expect(hold.entry.session).toBe(sockets[0].session);
    expect(sockets).toHaveLength(1);
    expect(clock.armed()).toBe(0);
  });

  test('a warmed socket nobody asks for closes when the period runs out', () => {
    const { cache, clock, sockets } = harness();
    cache.warm(URL_A);
    clock.elapse();
    expect(sockets[0].closed).toBe(true);
    expect(cache.size).toBe(0);
  });

  test('warming what is already open changes nothing', () => {
    const { cache, sockets } = harness();
    const hold = cache.acquire(URL_A);
    cache.warm(URL_A);
    expect(sockets).toHaveLength(1);
    expect(cache.isIdle(URL_A)).toBe(false);
    hold.release();
  });

  test('the probe seeds the list of a socket opened before it, until the server speaks', () => {
    const { cache, sockets } = harness();
    cache.warm(URL_A);
    const seed = parseSimfarmDevices({ devices: [RUNNING] });
    const hold = cache.acquire(URL_A, seed);
    expect(hold.entry.session.getState().devices).toEqual(seed);
    // Seeding attaches to nothing: that is the server's list to decide on.
    expect(sockets[0].requests()).toEqual([]);
  });
});

describe('letting go', () => {
  test('closing the idle sessions spares the held one', () => {
    const { cache, sockets } = harness();
    const held = cache.acquire(URL_A);
    cache.closeIdle();
    expect(sockets[0].closed).toBe(false);
    held.release();
    cache.closeIdle();
    expect(sockets[0].closed).toBe(true);
    expect(cache.size).toBe(0);
  });

  test('opening another machine closes the idle one', () => {
    const { cache, sockets } = harness();
    const a = cache.acquire(URL_A);
    a.release();
    cache.acquire(URL_B);
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].closed).toBe(false);
    expect(cache.size).toBe(1);
  });

  test('a transport that dropped while idle is gone at once', () => {
    const { cache, clock, sockets } = harness();
    const hold = cache.acquire(URL_A);
    hold.release();
    sockets[0].session.dropped();
    expect(cache.size).toBe(0);
    expect(clock.armed()).toBe(0);
  });

  test('a transport that dropped while held is kept for the screen, and not after', () => {
    const { cache, clock, sockets } = harness();
    const hold = cache.acquire(URL_A);
    sockets[0].session.dropped();
    // The screen is showing "lost" and its Look again; the entry is still its.
    expect(cache.size).toBe(1);
    expect(hold.entry.session.getState().status).toBe('lost');
    hold.release();
    expect(cache.size).toBe(0);
    expect(clock.armed()).toBe(0);
    // Looking again is a new socket.
    cache.acquire(URL_A);
    expect(sockets).toHaveLength(2);
  });
});
