// The state machine between the picker and the socket.
//
// The path pinned hardest is the one #47 never exercised: a device that is not
// running has to be booted before it can be attached, "booted" is something the
// device list says rather than something the reply promises, and a boot that
// fails, is refused or never finishes has to end somewhere a person can read.
// The socket is a fake that records what was sent, the clock is a fake that
// fires when told, and every frame the server would send is built with the
// same encoders the protocol tests pin.
import { describe, expect, test } from 'bun:test';

import { parseSimfarmDevices, type SimfarmDevice } from '@/lib/simfarm';
import { SIMFARM_CHANNEL, SIMFARM_VIDEO_TAG } from '@/lib/simfarm-protocol';
import {
  SimfarmSession,
  type SimfarmSessionState,
  type SimfarmTransport,
} from '@/lib/simfarm-session';

const RUNNING = {
  id: 'ios:running',
  name: 'iPhone 17 (iOS 26.5)',
  state: 'booted',
  screen: { width: 1206, height: 2622, scale: 3 },
  capabilities: { video: ['h264', 'jpeg'], text: true, buttons: ['home'], boot: true },
};
const COLD = {
  id: 'ios:cold',
  name: 'iPhone 17 Pro (iOS 26.5)',
  state: 'shutdown',
  capabilities: { video: ['h264', 'jpeg'], text: true, buttons: ['home'], boot: true },
};
const AVD = {
  id: 'android:emulator-5554',
  name: 'Pixel 9',
  state: 'shutdown',
  capabilities: { video: ['h264', 'jpeg'], text: true, buttons: ['home', 'back'], boot: false },
};

class FakeSocket implements SimfarmTransport {
  readyState = 1;
  readonly sent: Uint8Array[] = [];
  closed = false;
  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  /** The CONTROL requests sent so far, decoded, oldest first. */
  requests(): Record<string, unknown>[] {
    return this.sent
      .filter((bytes) => bytes[0] === SIMFARM_CHANNEL.CONTROL)
      .map((bytes) => JSON.parse(Buffer.from(bytes.subarray(1)).toString('utf8')));
  }
  last(): Record<string, unknown> {
    const all = this.requests();
    return all[all.length - 1];
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
  /** Fire every timer that is still armed, as if the deadline had passed. */
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
const frame = (streamId: number, tag: number) =>
  Uint8Array.from([SIMFARM_CHANNEL.VIDEO, streamId, tag, 0xff, 0xd8, 0xff]).buffer;

function open(options: { seed?: unknown[]; bootTimeoutMs?: number } = {}) {
  const socket = new FakeSocket();
  const clock = new FakeClock();
  const frames: (Uint8Array | null)[] = [];
  const states: SimfarmSessionState[] = [];
  const seed: SimfarmDevice[] = parseSimfarmDevices({ devices: options.seed ?? [] });
  const session = new SimfarmSession({
    seed,
    onFrame: (payload) => frames.push(payload),
    schedule: clock.schedule,
    bootTimeoutMs: options.bootTimeoutMs ?? 1000,
  });
  session.subscribe((state) => states.push(state));
  session.connect(socket);
  session.opened();
  return { session, socket, clock, frames, states, statuses: () => states.map((s) => s.status) };
}

describe('the list arriving', () => {
  test('attaches to the one running device on its own', () => {
    const { session, socket } = open();
    session.received(devicesEvent([COLD, RUNNING]));
    expect(session.getState().status).toBe('attaching');
    expect(session.getState().wanted).toBe('ios:running');
    expect(socket.last()).toEqual({ id: 1, op: 'attach', deviceId: 'ios:running', codec: 'jpeg' });
  });

  test('a machine with nothing running is a list to pick from, not a failure', () => {
    // The report this came from: six simulators, all shut down. Before, this
    // was `picking` with every row disabled, which is a dead end wearing a
    // list's clothes.
    const { session, socket } = open();
    session.received(devicesEvent([COLD, AVD]));
    expect(session.getState().status).toBe('picking');
    expect(session.getState().error).toBeNull();
    expect(socket.requests()).toEqual([]);
  });
});

describe('select', () => {
  test('a running device is attached directly', () => {
    const { session, socket } = open({ seed: [RUNNING] });
    session.select('ios:running');
    expect(socket.last()).toEqual({ id: 1, op: 'attach', deviceId: 'ios:running', codec: 'jpeg' });
    expect(session.getState().status).toBe('attaching');
  });

  test('a device the list has not described is attached too, and the server decides', () => {
    const { session, socket } = open();
    session.select('ios:unknown');
    expect(socket.last().op).toBe('attach');
  });

  test('a device that is not running is booted, and the row says so', () => {
    const { session, socket } = open({ seed: [COLD] });
    session.select('ios:cold');
    expect(socket.last()).toEqual({ id: 1, op: 'boot', deviceId: 'ios:cold' });
    expect(session.getState()).toMatchObject({
      status: 'booting',
      wanted: 'ios:cold',
      device: null,
      error: null,
    });
  });
});

describe('boot, then attach', () => {
  test('the ok answer alone is not the moment; the list saying booted is', () => {
    const { session, socket, clock, statuses } = open({ seed: [COLD] });
    session.select('ios:cold');
    expect(clock.armed()).toBe(1);

    session.received(reply({ id: 1, ok: true, result: { ok: true } }));
    // Still booting: the list has not said so yet.
    expect(session.getState().status).toBe('booting');
    expect(socket.requests().map((r) => r.op)).toEqual(['boot']);

    session.received(devicesEvent([{ ...COLD, state: 'booted' }]));
    expect(session.getState().status).toBe('attaching');
    expect(socket.last()).toEqual({ id: 2, op: 'attach', deviceId: 'ios:cold', codec: 'jpeg' });
    // The deadline is disarmed the moment the boot is over.
    expect(clock.armed()).toBe(0);
    // Never `picking` or `live` in between: the list arriving is a notification
    // too, but it repeats `booting` rather than passing through anything else.
    expect([...new Set(statuses())]).toEqual(['booting', 'attaching']);
  });

  test('the list can say booted before the answer arrives, and the late answer is ignored', () => {
    // The server polls the simulators on its own clock, so a `devices` push
    // can land while `simctl bootstatus` is still being waited on.
    const { session, socket } = open({ seed: [COLD] });
    session.select('ios:cold');
    session.received(devicesEvent([{ ...COLD, state: 'booted' }]));
    expect(session.getState().status).toBe('attaching');
    const before = socket.requests().length;
    session.received(reply({ id: 1, ok: true }));
    session.received(reply({ id: 1, ok: false, error: 'too late to matter' }));
    expect(socket.requests().length).toBe(before);
    expect(session.getState().status).toBe('attaching');
    expect(session.getState().error).toBeNull();
  });

  test('a list that still says shutdown keeps waiting rather than attaching blind', () => {
    const { session, socket } = open({ seed: [COLD, RUNNING] });
    session.select('ios:cold');
    session.received(devicesEvent([COLD, RUNNING]));
    expect(session.getState().status).toBe('booting');
    expect(socket.requests().map((r) => r.op)).toEqual(['boot']);
  });

  test('and then the picture arrives, through the attach answer', () => {
    const { session, frames } = open({ seed: [COLD] });
    session.select('ios:cold');
    session.received(reply({ id: 1, ok: true }));
    session.received(devicesEvent([{ ...COLD, state: 'booted' }]));
    session.received(
      reply({
        id: 2,
        ok: true,
        streamId: 0,
        codec: 'jpeg',
        device: {
          ...COLD,
          state: 'booted',
          screen: { width: 1206, height: 2622, scale: 3, frameRotation: 0 },
        },
      })
    );
    expect(session.getState().device?.name).toBe(COLD.name);
    expect(session.getState().screen).toEqual({ width: 1206, height: 2622, scale: 3, rotation: 0 });
    session.received(frame(0, SIMFARM_VIDEO_TAG.SEED));
    expect(session.getState().status).toBe('live');
    // One `null` for each time the picture was cleared, then the jpeg.
    expect(frames.filter((f) => f !== null).length).toBe(1);
  });
});

describe('boot failing', () => {
  test("the server's refusal ends in the list, with its words kept", () => {
    const { session, clock } = open({ seed: [COLD] });
    session.select('ios:cold');
    session.received(reply({ id: 1, ok: false, error: 'simctl boot failed: Unable to boot' }));
    expect(session.getState()).toMatchObject({
      status: 'picking',
      wanted: 'ios:cold',
      error: { kind: 'boot-failed', detail: 'simctl boot failed: Unable to boot' },
    });
    expect(clock.armed()).toBe(0);
  });

  test('a provider that cannot start devices is refused here, without a round trip', () => {
    // `adb` cannot start an AVD. simfarm's own client draws no start button
    // for such a device; this asks nothing and says why.
    const { session, socket } = open({ seed: [AVD] });
    session.select('android:emulator-5554');
    expect(socket.requests()).toEqual([]);
    expect(session.getState()).toMatchObject({
      status: 'picking',
      error: { kind: 'boot-unsupported', detail: null },
    });
  });

  test('a device that never comes up is given up on at the deadline', () => {
    const { session, socket, clock } = open({ seed: [COLD] });
    session.select('ios:cold');
    session.received(reply({ id: 1, ok: true }));
    clock.elapse();
    expect(session.getState()).toMatchObject({
      status: 'picking',
      error: { kind: 'boot-timeout', detail: null },
    });
    // A `booted` that turns up after the deadline no longer belongs to anyone.
    session.received(devicesEvent([{ ...COLD, state: 'booted' }]));
    expect(socket.requests().map((r) => r.op)).toEqual(['boot']);
    expect(session.getState().status).toBe('picking');
  });

  test('a deadline that already passed does not fire into a later choice', () => {
    const { session, socket, clock } = open({ seed: [COLD, RUNNING] });
    session.select('ios:cold');
    session.select('ios:running');
    expect(clock.armed()).toBe(0);
    clock.elapse();
    expect(session.getState().status).toBe('attaching');
    expect(session.getState().error).toBeNull();
    expect(socket.requests().map((r) => r.op)).toEqual(['boot', 'attach']);
  });

  test('the failure is cleared by the next choice', () => {
    const { session } = open({ seed: [COLD, RUNNING] });
    session.select('ios:cold');
    session.received(reply({ id: 1, ok: false, error: 'no' }));
    session.select('ios:running');
    expect(session.getState().error).toBeNull();
  });
});

describe('switching', () => {
  test('booting another device detaches the one on screen first', () => {
    const { session, socket, frames } = open({ seed: [RUNNING, COLD] });
    session.select('ios:running');
    session.received(reply({ id: 1, ok: true, streamId: 3, device: RUNNING }));
    session.received(frame(3, SIMFARM_VIDEO_TAG.KEY));
    expect(session.getState().status).toBe('live');

    session.select('ios:cold');
    expect(socket.requests().map((r) => r.op)).toEqual(['attach', 'detach', 'boot']);
    expect(socket.requests()[1]).toMatchObject({ streamId: 3 });
    expect(frames[frames.length - 1]).toBeNull();
    expect(session.getState()).toMatchObject({ status: 'booting', device: null, screen: null });
    // A frame for the stream just let go of is not the new device's picture.
    session.received(frame(3, SIMFARM_VIDEO_TAG.KEY));
    expect(session.getState().status).toBe('booting');
  });

  test('an attach the server refuses lands in the list with the reason', () => {
    const { session } = open({ seed: [RUNNING] });
    session.select('ios:running');
    session.received(
      reply({ id: 1, ok: false, error: 'simulator iPhone 17 is shutdown; send boot first' })
    );
    expect(session.getState()).toMatchObject({
      status: 'picking',
      error: { kind: 'attach-failed', detail: 'simulator iPhone 17 is shutdown; send boot first' },
    });
  });
});

describe('the transport', () => {
  test('a choice made before the socket opened is sent once it has', () => {
    const socket = new FakeSocket();
    socket.readyState = 0;
    const session = new SimfarmSession({
      seed: parseSimfarmDevices({ devices: [COLD] }),
      onFrame: () => {},
      schedule: () => () => {},
    });
    session.connect(socket);
    session.select('ios:cold');
    expect(socket.sent).toEqual([]);
    socket.readyState = 1;
    session.opened();
    expect(socket.last()).toMatchObject({ op: 'boot', deviceId: 'ios:cold' });
  });

  test('release detaches, closes, and disarms a boot in flight', () => {
    const { session, socket, clock } = open({ seed: [RUNNING, COLD] });
    session.select('ios:running');
    session.received(reply({ id: 1, ok: true, streamId: 0, device: RUNNING }));
    session.release();
    expect(socket.last()).toEqual({ id: 2, op: 'detach', streamId: 0 });
    expect(socket.closed).toBe(true);

    const again = open({ seed: [COLD] });
    again.session.select('ios:cold');
    expect(again.clock.armed()).toBe(1);
    again.session.release();
    expect(again.clock.armed()).toBe(0);
    expect(clock.armed()).toBe(0);
  });

  test('dropping is reported as lost and nothing is retried', () => {
    const { session, socket } = open({ seed: [COLD] });
    session.select('ios:cold');
    session.dropped();
    expect(session.getState().status).toBe('lost');
    expect(socket.requests().map((r) => r.op)).toEqual(['boot']);
  });

  test('a frame that says nothing new does not wake the listeners', () => {
    const { session, states } = open({ seed: [RUNNING] });
    session.select('ios:running');
    session.received(reply({ id: 1, ok: true, streamId: 0, device: RUNNING }));
    const before = states.length;
    session.received(frame(0, SIMFARM_VIDEO_TAG.SEED));
    session.received(frame(0, SIMFARM_VIDEO_TAG.KEY));
    session.received(frame(0, SIMFARM_VIDEO_TAG.KEY));
    // One notification for `live`; the two frames after it change nothing.
    expect(states.length).toBe(before + 1);
  });
});
