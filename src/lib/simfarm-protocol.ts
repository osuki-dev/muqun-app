/**
 * simfarm's wire protocol v1, in the half of it this app speaks.
 *
 * The app used to put simfarm's own browser client in a web view and let it do
 * this. That client is a desktop instrument -- it reserves a rail column and a
 * pill row out of the window, snaps its zoom to 50/75/100% and never goes above
 * 1:1 -- so on a phone it drew the device at half size with the rest of the
 * screen empty, and its device picker landed underneath the sheet's grabber
 * where no press could reach it. None of that is fixable from outside a page,
 * so the app now speaks the protocol itself. `simfarm-preview.tsx` records the
 * measurements that decided it.
 *
 * ## Why only half of it
 *
 * Everything here is what a viewer needs and nothing more: attach, the video
 * frames, touch, text, the hardware buttons. Absent on purpose are the h264
 * path (Hermes has no video decoder, and the stream is requested as jpeg for
 * exactly that reason), the WeChat dialog channel, `rotate` -- the device is
 * turned on the machine it runs on, and a phone held in one hand is not where
 * that decision belongs -- and the wheel-scroll frame, because a finger dragged
 * across a phone is a touch drag, and the device produces its own scrolling and
 * its own momentum from it.
 *
 * ## The two rules that are easy to get wrong
 *
 * **Every multi-byte number is big-endian**, floats included, without
 * exception. And **coordinates are normalized to [0,1] against the picture the
 * viewer is looking at**, already rotated upright -- so the client never does
 * coordinate arithmetic in device pixels, and a rotated device needs no special
 * case here. The server clamps anything outside the range; `simfarm-frame.ts`
 * clamps it too, because a value that arrives clamped is a value whose bug is
 * invisible.
 *
 * Pure, and tested as such: this is the one file where a byte in the wrong
 * place produces a tap somewhere else on the device rather than an error, and
 * that is not a class of bug worth discovering on a simulator.
 */
import { utf8Bytes } from '@/lib/multipart';

/** `[1B channel][payload]`, the frame every message is wrapped in. */
export const SIMFARM_CHANNEL = {
  VIDEO: 0x01,
  INPUT: 0x02,
  CONTROL: 0x03,
  EVENT: 0x04,
} as const;

/** The video tags. `SEED` is always a jpeg, whatever the stream's codec is. */
export const SIMFARM_VIDEO_TAG = {
  CONFIG: 0x01,
  KEY: 0x02,
  DELTA: 0x03,
  SEED: 0x04,
} as const;

const INPUT_KIND = {
  TOUCH: 0x10,
  MULTITOUCH: 0x11,
  KEY: 0x12,
  BUTTON: 0x13,
  TEXT: 0x15,
} as const;

/** `0=begin 1=move 2=end` for touches; `0=down 1=up` for keys and buttons. */
export const SIMFARM_TOUCH_PHASE = { BEGIN: 0, MOVE: 1, END: 2 } as const;
export type SimfarmTouchPhase = (typeof SIMFARM_TOUCH_PHASE)[keyof typeof SIMFARM_TOUCH_PHASE];

/**
 * Which edge a gesture started at, decided once at `begin` and held for the
 * whole gesture.
 *
 * iOS only recognises a system gesture that *starts* at an edge, so this is not
 * a hint the server could derive from the coordinates it already has: by the
 * time the finger has moved, the fact that it began on the bottom edge is gone.
 */
export const SIMFARM_EDGE = {
  none: 0,
  top: 1,
  bottom: 2,
  left: 3,
  right: 4,
} as const;
export type SimfarmEdge = keyof typeof SIMFARM_EDGE;

/**
 * The buttons a device may declare, and the byte each one is on the wire.
 *
 * `capabilities.buttons` is an array of these names; the mapping is part of the
 * protocol rather than something a client may invent, so it is written down
 * once here and the preview only ever offers a name the device declared.
 */
export const SIMFARM_BUTTON = {
  home: 0x01,
  lock: 0x02,
  volume_up: 0x03,
  volume_down: 0x04,
  back: 0x05,
  app_switch: 0x06,
  power: 0x07,
  siri: 0x08,
  menu: 0x09,
  camera: 0x0a,
  ringer_mute: 0x0b,
  action: 0x0c,
} as const;
export type SimfarmButton = keyof typeof SIMFARM_BUTTON;

/** What a decoded inbound frame turned out to be. */
export type SimfarmInbound =
  | { channel: 'video'; streamId: number; tag: number; payload: Uint8Array }
  /**
   * Both JSON channels decode to the same shape. They are told apart by their
   * content and not by their channel: a CONTROL message always carries the `id`
   * of the request it answers, an EVENT never does.
   */
  | { channel: 'control'; body: Record<string, unknown> }
  | { channel: 'event'; body: Record<string, unknown> };

/** A CONTROL request. `id` must increase; the answer carries it back. */
export interface SimfarmControlRequest {
  id: number;
  op: string;
  [key: string]: unknown;
}

export function encodeSimfarmControl(request: SimfarmControlRequest): Uint8Array {
  const json = utf8Bytes(JSON.stringify(request));
  const out = new Uint8Array(1 + json.length);
  out[0] = SIMFARM_CHANNEL.CONTROL;
  out.set(json, 1);
  return out;
}

/**
 * `[0x02][streamId][0x10][phase][f32 x][f32 y][u16 seq][edge]`.
 *
 * `seq` only has to increase within one gesture and may wrap; the server uses
 * it to drop a move that arrives after a later one and handles the wrap itself.
 * `begin` and `end` are never dropped, so a gesture is never left half-open.
 */
export function encodeSimfarmTouch(input: {
  streamId: number;
  phase: SimfarmTouchPhase;
  x: number;
  y: number;
  seq: number;
  edge?: SimfarmEdge;
}): Uint8Array {
  const out = new Uint8Array(15);
  const view = new DataView(out.buffer);
  out[0] = SIMFARM_CHANNEL.INPUT;
  out[1] = input.streamId & 0xff;
  out[2] = INPUT_KIND.TOUCH;
  out[3] = input.phase;
  view.setFloat32(4, clamp01(input.x));
  view.setFloat32(8, clamp01(input.y));
  view.setUint16(12, input.seq & 0xffff);
  out[14] = SIMFARM_EDGE[input.edge ?? 'none'];
  return out;
}

/** `[0x02][streamId][0x15][utf-8...]` -- no length prefix, it runs to the end. */
export function encodeSimfarmText(input: { streamId: number; text: string }): Uint8Array {
  const body = utf8Bytes(input.text);
  const out = new Uint8Array(3 + body.length);
  out[0] = SIMFARM_CHANNEL.INPUT;
  out[1] = input.streamId & 0xff;
  out[2] = INPUT_KIND.TEXT;
  out.set(body, 3);
  return out;
}

/** `[0x02][streamId][0x13][phase][buttonId]`, phase `0=down 1=up`. */
export function encodeSimfarmButton(input: {
  streamId: number;
  button: SimfarmButton;
  down: boolean;
}): Uint8Array {
  const out = new Uint8Array(5);
  out[0] = SIMFARM_CHANNEL.INPUT;
  out[1] = input.streamId & 0xff;
  out[2] = INPUT_KIND.BUTTON;
  out[3] = input.down ? 0 : 1;
  out[4] = SIMFARM_BUTTON[input.button];
  return out;
}

/**
 * A frame off the socket, or `null` when there is nothing usable in it.
 *
 * Tolerant for the same reason `parseSimfarmDevices` is: this is a shape owned
 * by a project on a different release cadence, and the useful failure is a
 * dropped frame rather than an exception out of a socket callback. A channel we
 * do not know, a truncated header, a JSON body that is not an object -- all of
 * them are `null`, and the caller carries on with the picture it already has.
 */
export function decodeSimfarmFrame(data: ArrayBuffer | ArrayBufferView): SimfarmInbound | null {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.length < 2) return null;

  const channel = bytes[0];
  if (channel === SIMFARM_CHANNEL.VIDEO) {
    if (bytes.length < 3) return null;
    return {
      channel: 'video',
      streamId: bytes[1],
      tag: bytes[2],
      // A view, not a copy: the payload is a whole jpeg and this runs once per
      // frame. Nothing downstream keeps it past the decode.
      payload: bytes.subarray(3),
    };
  }

  if (channel === SIMFARM_CHANNEL.CONTROL || channel === SIMFARM_CHANNEL.EVENT) {
    let body: unknown;
    try {
      body = JSON.parse(utf8Text(bytes.subarray(1)));
    } catch {
      return null;
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return {
      channel: channel === SIMFARM_CHANNEL.CONTROL ? 'control' : 'event',
      body: body as Record<string, unknown>,
    };
  }

  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * UTF-8 without a `TextDecoder` global, which Hermes does not ship.
 *
 * The third of these in the tree, and deliberately not the same as either: the
 * one in `sse-record.ts` throws on a malformed sequence because a gateway that
 * sent one has a bug worth surfacing, and this one substitutes U+FFFD because
 * the bytes are a device name from another project and a mangled name must not
 * take a live picture down with it.
 */
function utf8Text(bytes: Uint8Array): string {
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    let code: number;
    let extra: number;
    if (byte < 0x80) {
      code = byte;
      extra = 0;
    } else if ((byte & 0xe0) === 0xc0) {
      code = byte & 0x1f;
      extra = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      code = byte & 0x0f;
      extra = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      code = byte & 0x07;
      extra = 3;
    } else {
      out += '�';
      index += 1;
      continue;
    }

    let valid = true;
    for (let step = 1; step <= extra; step += 1) {
      const next = bytes[index + step];
      if (next === undefined || (next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (next & 0x3f);
    }
    if (!valid) {
      out += '�';
      index += 1;
      continue;
    }

    index += extra + 1;
    if (code > 0xffff) {
      const shifted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}
