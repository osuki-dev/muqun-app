/**
 * The state machine behind the preview's socket: which device is wanted,
 * whether it is booting, attaching or live, and what goes down the wire to get
 * it there.
 *
 * Split out of `simfarm-stream.ts` so that it can be driven without React, a
 * WebSocket or Skia. The hook owns those three and nothing else; this owns the
 * decisions, and the decisions are the part worth pinning. The path that made
 * the split necessary is the one #47 never exercised: a device that is not
 * running has to be started before it can be attached, and "started" is
 * something the device list reports rather than something a reply promises.
 *
 * ## Why boot and attach are two steps and not one op
 *
 * simfarm's `boot` is a provider-level op (PROTOCOL §4). It names a device and
 * not a stream, because there is nothing to stream until the device is up. On
 * iOS the server waits on `simctl bootstatus` before it answers, so the answer
 * arrives booted; but the list is what says so with authority, and simfarm's
 * own client (`web/app.js`, `startOffered` and the `devices` case of `onEvent`)
 * attaches when the list shows the device booted rather than trusting the reply
 * on its own. This does the same, and takes whichever of the two arrives first.
 *
 * ## The deadline
 *
 * A cold simulator takes tens of seconds, and the server's own patience is 180s
 * before it gives up and answers `ok:false`. The client's deadline is the same
 * number: shorter and it would give up on a boot the server is still going to
 * finish; longer and a server that stopped answering leaves a spinner nobody
 * can dismiss except by picking something else.
 *
 * ## What it deliberately does not do
 *
 * It does not reconnect. A transport that dropped is reported as dropped and
 * the caller starts again -- which in practice means the probe runs and a fresh
 * hook opens a fresh socket, because the probe is the thing that can tell
 * "simfarm has gone" from "the connection blipped" and this cannot.
 */
import {
  parseSimfarmDevices,
  SIMFARM_CODEC,
  simfarmCanStream,
  type SimfarmDevice,
} from '@/lib/simfarm';
import { simfarmEdgeAt } from '@/lib/simfarm-frame';
import {
  decodeSimfarmFrame,
  encodeSimfarmBoot,
  encodeSimfarmButton,
  encodeSimfarmControl,
  encodeSimfarmText,
  encodeSimfarmTouch,
  readSimfarmControlReply,
  SIMFARM_BOOT_TIMEOUT_MS,
  SIMFARM_TOUCH_PHASE,
  SIMFARM_VIDEO_TAG,
  type SimfarmButton,
  type SimfarmControlReply,
  type SimfarmEdge,
  type SimfarmTouchPhase,
} from '@/lib/simfarm-protocol';

/**
 * Where the stream is, in the six states a reader can be told apart.
 *
 * `picking` is not an error and is why the list is a state rather than a
 * failure: a machine with two simulators booted has to be asked which one, and
 * a machine with none has a simfarm running with nothing on it -- both of them
 * are "no picture yet" for reasons no reconnection would fix. `booting` is the
 * one that can last a minute, and it is its own state so the screen can say
 * what is being waited for.
 */
export type SimfarmStreamStatus =
  | 'connecting'
  | 'picking'
  | 'booting'
  | 'attaching'
  | 'live'
  | 'lost';

/** The picture's size and which way up the frames arrive; see PROTOCOL §6. */
export interface SimfarmStreamScreen {
  width: number;
  height: number;
  scale: number;
  /** Degrees clockwise the decoded frame needs before it is upright. */
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Why there is no picture, when the reason is something the reader did.
 *
 * Sorted by kind rather than passed through as the server's sentence, because
 * the sentence on screen has to be translated and the server's is not; the
 * server's own words ride along in `detail` for the case where the kind is
 * not enough -- `boot` reaches very different machinery per backend, and a
 * generic "could not start" would throw away the only useful part.
 */
export interface SimfarmStreamError {
  kind: 'boot-unsupported' | 'boot-failed' | 'boot-timeout' | 'attach-failed';
  detail: string | null;
}

export interface SimfarmSessionState {
  status: SimfarmStreamStatus;
  devices: SimfarmDevice[];
  /** The device the reader asked for, whether or not it is attached yet. */
  wanted: string | null;
  /** The device a stream is open on, as the attach answer described it. */
  device: SimfarmDevice | null;
  screen: SimfarmStreamScreen | null;
  error: SimfarmStreamError | null;
}

/** The half of a WebSocket this needs: whether it is open, and a way to send. */
export interface SimfarmTransport {
  /** `1` is open, as on a WebSocket; nothing is sent on any other value. */
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(): void;
}

/** `setTimeout` in the shape a test can stand in for; returns the cancel. */
export type SimfarmSchedule = (run: () => void, ms: number) => () => void;

const scheduleWithTimers: SimfarmSchedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export function initialSimfarmSessionState(seed: SimfarmDevice[]): SimfarmSessionState {
  return {
    status: 'connecting',
    devices: seed,
    wanted: null,
    device: null,
    screen: null,
    error: null,
  };
}

export class SimfarmSession {
  private state: SimfarmSessionState;
  private readonly listeners = new Set<(state: SimfarmSessionState) => void>();
  private transport: SimfarmTransport | null = null;
  private nextId = 1;
  private streamId: number | null = null;
  /**
   * Which request the attach answer belongs to, so a reply for a device the
   * reader has already moved on from cannot claim the stream. Reusing a
   * `streamId` after a detach is legal in the protocol, so "an attach answer
   * arrived" is not on its own enough to act on.
   */
  private pendingAttach: { id: number; deviceId: string } | null = null;
  /**
   * The boot in flight. `requestId` is cleared once the server has answered
   * `ok`, and the whole record is cleared once the device is attached or the
   * boot has failed -- so it outlives the reply on purpose, because the reply
   * is not the moment the device is usable; the list saying `booted` is.
   */
  private booting: { deviceId: string; requestId: number | null; cancel: () => void } | null = null;
  private seq = 0;
  /**
   * The edge the gesture in flight began at, decided at `begin` and repeated
   * unchanged afterwards, because iOS only recognises a system gesture that
   * *started* at an edge and by the second move that fact is no longer in the
   * coordinates.
   */
  private edge: SimfarmEdge = 'none';
  private readonly onFrame: (payload: Uint8Array | null) => void;
  private readonly schedule: SimfarmSchedule;
  private readonly bootTimeoutMs: number;

  constructor(options: {
    /** What the probe already found, so the picker has a list before the socket has said anything. */
    seed: SimfarmDevice[];
    /** A jpeg to draw, or `null` when the picture on screen no longer applies. */
    onFrame: (payload: Uint8Array | null) => void;
    schedule?: SimfarmSchedule;
    bootTimeoutMs?: number;
  }) {
    this.state = initialSimfarmSessionState(options.seed);
    this.onFrame = options.onFrame;
    this.schedule = options.schedule ?? scheduleWithTimers;
    this.bootTimeoutMs = options.bootTimeoutMs ?? SIMFARM_BOOT_TIMEOUT_MS;
  }

  getState(): SimfarmSessionState {
    return this.state;
  }

  subscribe(listener: (state: SimfarmSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // the transport's side
  // ---------------------------------------------------------------------------

  connect(transport: SimfarmTransport): void {
    this.transport = transport;
    this.update({ status: 'connecting' });
  }

  /** The transport is open. The server pushes `devices` on its own, so nothing is asked for. */
  opened(): void {
    // A choice made before the socket was open was sent to nobody; make it now.
    if (this.state.wanted !== null) this.select(this.state.wanted);
  }

  /** The transport closed or failed underneath the session. */
  dropped(): void {
    this.cancelBoot();
    this.update({ status: 'lost' });
  }

  /** One binary message off the transport. */
  received(data: ArrayBuffer | ArrayBufferView): void {
    const frame = decodeSimfarmFrame(data);
    if (frame === null) return;

    if (frame.channel === 'video') {
      if (frame.streamId !== this.streamId) return;
      if (frame.tag !== SIMFARM_VIDEO_TAG.SEED && frame.tag !== SIMFARM_VIDEO_TAG.KEY) return;
      this.onFrame(frame.payload);
      this.update({ status: 'live' });
      return;
    }

    if (frame.channel === 'event') {
      const kind = frame.body.ev;
      if (kind === 'devices') this.onDevices(parseSimfarmDevices(frame.body));
      else if (kind === 'screen' && frame.body.streamId === this.streamId) {
        this.update({ screen: readScreen(frame.body) });
      }
      return;
    }

    const reply = readSimfarmControlReply(frame.body);
    if (reply === null) return;
    if (this.booting !== null && this.booting.requestId === reply.id) this.onBootReply(reply);
    else if (this.pendingAttach !== null && this.pendingAttach.id === reply.id) {
      this.onAttachReply(reply);
    }
  }

  /**
   * Let go of the transport, detaching first if there is still a stream on it.
   *
   * Best effort: a detach on a socket already on its way down is a no-op, and
   * the server drops the stream when the connection goes anyway.
   */
  release(): void {
    this.cancelBoot();
    const live = this.transport;
    if (live !== null) {
      const held = this.streamId;
      if (held !== null && live.readyState === 1) {
        live.send(encodeSimfarmControl({ id: this.nextId++, op: 'detach', streamId: held }));
      }
      live.close();
    }
    this.streamId = null;
    this.pendingAttach = null;
    this.transport = null;
  }

  // ---------------------------------------------------------------------------
  // the reader's side
  // ---------------------------------------------------------------------------

  /**
   * Show this device: attach to it if it is running, start it first if not.
   *
   * One verb for the row in the picker, because from where the reader stands
   * both are "show me that one". A device the list has not described yet is
   * attached directly and the server says if it cannot be.
   */
  select(deviceId: string): void {
    const listed = this.state.devices.find((entry) => entry.id === deviceId);
    if (listed !== undefined && !listed.booted) this.boot(deviceId);
    else this.attach(deviceId);
  }

  /** Attach to a device, replacing whatever is attached now. */
  attach(deviceId: string): void {
    this.cancelBoot();
    this.dropStream();
    this.update({
      wanted: deviceId,
      status: 'attaching',
      error: null,
      device: null,
      screen: null,
    });
    const id = this.nextId++;
    this.pendingAttach = { id, deviceId };
    this.send(encodeSimfarmControl({ id, op: 'attach', deviceId, codec: SIMFARM_CODEC }));
  }

  /**
   * Start a device that is not running, and attach to it once it is.
   *
   * A device whose provider has said it cannot start it is refused here rather
   * than asked, for the reason simfarm's client draws no start button for one:
   * `adb` cannot start an AVD, and the useful sentence is "start it yourself"
   * rather than the server's refusal a round trip later.
   */
  boot(deviceId: string): void {
    this.cancelBoot();
    this.dropStream();
    this.update({
      wanted: deviceId,
      status: 'booting',
      error: null,
      device: null,
      screen: null,
    });
    const listed = this.state.devices.find((entry) => entry.id === deviceId);
    if (listed !== undefined && !listed.capabilities.boot) {
      this.update({ status: 'picking', error: { kind: 'boot-unsupported', detail: null } });
      return;
    }
    const id = this.nextId++;
    this.booting = {
      deviceId,
      requestId: id,
      cancel: this.schedule(() => this.bootTimedOut(deviceId), this.bootTimeoutMs),
    };
    this.send(encodeSimfarmBoot({ id, deviceId }));
  }

  touch(input: { phase: SimfarmTouchPhase; x: number; y: number }): void {
    const id = this.streamId;
    if (id === null) return;
    if (input.phase === SIMFARM_TOUCH_PHASE.BEGIN) {
      this.edge = simfarmEdgeAt({ x: input.x, y: input.y });
    }
    this.send(
      encodeSimfarmTouch({
        streamId: id,
        phase: input.phase,
        x: input.x,
        y: input.y,
        seq: this.seq++ & 0xffff,
        edge: this.edge,
      })
    );
    if (input.phase === SIMFARM_TOUCH_PHASE.END) this.edge = 'none';
  }

  type(text: string): void {
    const id = this.streamId;
    if (id === null || text === '') return;
    this.send(encodeSimfarmText({ streamId: id, text }));
  }

  press(button: SimfarmButton): void {
    const id = this.streamId;
    if (id === null) return;
    this.send(encodeSimfarmButton({ streamId: id, button, down: true }));
    this.send(encodeSimfarmButton({ streamId: id, button, down: false }));
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private onDevices(listed: SimfarmDevice[]): void {
    this.update({ devices: listed });
    if (this.booting !== null) {
      this.attachIfBooted();
      return;
    }
    if (this.state.wanted !== null) return;
    const first = listed.find((entry) => entry.booted && simfarmCanStream(entry));
    if (first !== undefined) this.attach(first.id);
    else this.update({ status: 'picking' });
  }

  private onBootReply(reply: SimfarmControlReply): void {
    if (this.booting === null) return;
    if (!reply.ok) {
      this.cancelBoot();
      this.update({ status: 'picking', error: { kind: 'boot-failed', detail: reply.error } });
      return;
    }
    // Answered, not finished: the device is usable when the list says it is,
    // and on some backends that is a poll later.
    this.booting.requestId = null;
    this.attachIfBooted();
  }

  private attachIfBooted(): void {
    const booting = this.booting;
    if (booting === null) return;
    const listed = this.state.devices.find((entry) => entry.id === booting.deviceId);
    if (listed === undefined || !listed.booted) return;
    this.attach(booting.deviceId);
  }

  private bootTimedOut(deviceId: string): void {
    if (this.booting === null || this.booting.deviceId !== deviceId) return;
    this.booting = null;
    this.update({ status: 'picking', error: { kind: 'boot-timeout', detail: null } });
  }

  private cancelBoot(): void {
    if (this.booting === null) return;
    this.booting.cancel();
    this.booting = null;
  }

  private onAttachReply(reply: SimfarmControlReply): void {
    this.pendingAttach = null;
    if (!reply.ok) {
      this.update({ status: 'picking', error: { kind: 'attach-failed', detail: reply.error } });
      return;
    }
    const streamId = reply.body.streamId;
    if (typeof streamId !== 'number') {
      this.update({ status: 'picking', error: { kind: 'attach-failed', detail: null } });
      return;
    }
    this.streamId = streamId;
    const attached = parseSimfarmDevices({ devices: [reply.body.device] })[0] ?? null;
    const reported = readScreen(reply.body.device);
    this.update({ device: attached, screen: reported ?? this.state.screen });
  }

  /**
   * Let go of the stream, so a machine driving two simulators is not left
   * encoding a picture nobody is looking at, and take the picture off the
   * screen with it.
   */
  private dropStream(): void {
    const held = this.streamId;
    this.streamId = null;
    this.pendingAttach = null;
    this.onFrame(null);
    if (held !== null) {
      this.send(encodeSimfarmControl({ id: this.nextId++, op: 'detach', streamId: held }));
    }
  }

  private send(bytes: Uint8Array): void {
    const live = this.transport;
    if (live === null || live.readyState !== 1) return;
    live.send(bytes);
  }

  /**
   * A new snapshot, but only when something in it is new: a frame arrives six
   * times a second and each one says `live`, and a listener told about a state
   * identical to the last is a render for nothing.
   */
  private update(patch: Partial<SimfarmSessionState>): void {
    const previous = this.state;
    const next: SimfarmSessionState = { ...previous, ...patch };
    const changed = (Object.keys(patch) as (keyof SimfarmSessionState)[]).some(
      (key) => next[key] !== previous[key]
    );
    if (!changed) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

/**
 * The `screen` block off an event or an attach answer.
 *
 * `width`/`height` are the picture a person sees -- already swapped for a
 * rotated device -- while `rotation` says how far the frames themselves still
 * have to be turned. The two are independent, and treating them as one is how a
 * client ends up with a sideways iPhone or a correctly-turned Android drawn on
 * its side.
 */
function readScreen(value: unknown): SimfarmStreamScreen | null {
  if (typeof value !== 'object' || value === null) return null;
  const source = 'screen' in value ? (value as { screen?: unknown }).screen : value;
  if (typeof source !== 'object' || source === null) return null;
  const { width, height, scale, frameRotation } = source as Record<string, unknown>;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (!(width > 0) || !(height > 0)) return null;
  return {
    width,
    height,
    scale: typeof scale === 'number' && scale > 0 ? scale : 1,
    rotation:
      frameRotation === 90 || frameRotation === 180 || frameRotation === 270 ? frameRotation : 0,
  };
}
