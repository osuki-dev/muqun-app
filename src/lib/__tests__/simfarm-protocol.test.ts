// simfarm's wire protocol, in the half the preview speaks.
//
// This is the one file in the feature where a mistake is not an error. A byte
// in the wrong place does not throw and does not log: it puts a tap somewhere
// else on someone's simulator, or drops a frame, or leaves a finger down on a
// device across the room. So the encoders are pinned byte for byte against the
// layouts in simfarm's PROTOCOL.md rather than against themselves, and the
// decoder is pinned on the malformed input as hard as on the good.
//
// The two rules underneath all of it: every multi-byte number is big-endian,
// and coordinates are fractions of the picture rather than device pixels.
import { describe, expect, test } from 'bun:test';

import {
  decodeSimfarmFrame,
  encodeSimfarmBoot,
  encodeSimfarmButton,
  encodeSimfarmControl,
  encodeSimfarmText,
  encodeSimfarmTouch,
  readSimfarmControlReply,
  SIMFARM_BOOT_TIMEOUT_MS,
  SIMFARM_CHANNEL,
  SIMFARM_TOUCH_PHASE,
  SIMFARM_VIDEO_TAG,
} from '@/lib/simfarm-protocol';

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe('encodeSimfarmTouch', () => {
  test('is the fifteen bytes PROTOCOL.md lays out, big-endian', () => {
    const frame = encodeSimfarmTouch({
      streamId: 3,
      phase: SIMFARM_TOUCH_PHASE.BEGIN,
      x: 0.25,
      y: 0.5,
      seq: 7,
      edge: 'bottom',
    });
    expect(frame.length).toBe(15);
    expect(frame[0]).toBe(SIMFARM_CHANNEL.INPUT);
    expect(frame[1]).toBe(3);
    expect(frame[2]).toBe(0x10);
    expect(frame[3]).toBe(0);
    // Read back the way the server reads it: `false` would be little-endian,
    // and a little-endian 0.25 is a number nowhere near a quarter of the way
    // across the screen.
    expect(view(frame).getFloat32(4, false)).toBe(0.25);
    expect(view(frame).getFloat32(8, false)).toBe(0.5);
    expect(view(frame).getUint16(12, false)).toBe(7);
    expect(frame[14]).toBe(2);
  });

  test('defaults to no edge, and phases are the ones the server accepts', () => {
    expect(encodeSimfarmTouch({ streamId: 0, phase: 1, x: 0, y: 0, seq: 0 })[14]).toBe(0);
    expect(encodeSimfarmTouch({ streamId: 0, phase: 2, x: 0, y: 0, seq: 0 })[3]).toBe(2);
  });

  test('a sequence number wraps rather than overflowing its two bytes', () => {
    // Legal by the protocol: the server compares with the wrap in mind. What
    // would not be legal is a third byte appearing in the middle of the frame.
    const frame = encodeSimfarmTouch({ streamId: 0, phase: 1, x: 0, y: 0, seq: 0x1_0001 });
    expect(frame.length).toBe(15);
    expect(view(frame).getUint16(12, false)).toBe(1);
  });

  test('coordinates are clamped rather than sent out of range', () => {
    const low = encodeSimfarmTouch({ streamId: 0, phase: 0, x: -2, y: 5, seq: 0 });
    expect(view(low).getFloat32(4, false)).toBe(0);
    expect(view(low).getFloat32(8, false)).toBe(1);
    // A NaN would reach the server as a coordinate it cannot compare, so it is
    // pinned to the origin here rather than passed on.
    const bad = encodeSimfarmTouch({ streamId: 0, phase: 0, x: Number.NaN, y: 0.5, seq: 0 });
    expect(view(bad).getFloat32(4, false)).toBe(0);
  });
});

describe('encodeSimfarmButton', () => {
  test('carries the id from the protocol table, down then up', () => {
    const down = encodeSimfarmButton({ streamId: 1, button: 'home', down: true });
    const up = encodeSimfarmButton({ streamId: 1, button: 'home', down: false });
    expect([...down]).toEqual([SIMFARM_CHANNEL.INPUT, 1, 0x13, 0, 0x01]);
    expect([...up]).toEqual([SIMFARM_CHANNEL.INPUT, 1, 0x13, 1, 0x01]);
    expect(encodeSimfarmButton({ streamId: 0, button: 'app_switch', down: true })[4]).toBe(0x06);
    expect(encodeSimfarmButton({ streamId: 0, button: 'back', down: true })[4]).toBe(0x05);
    expect(encodeSimfarmButton({ streamId: 0, button: 'lock', down: true })[4]).toBe(0x02);
  });
});

describe('encodeSimfarmText', () => {
  test('is the string in UTF-8, running to the end with no length prefix', () => {
    const frame = encodeSimfarmText({ streamId: 2, text: 'hi' });
    expect([...frame]).toEqual([SIMFARM_CHANNEL.INPUT, 2, 0x15, 0x68, 0x69]);
  });

  test('sends a character outside ASCII as its UTF-8 bytes', () => {
    // The composer takes whatever the reader's keyboard produces, so a name or
    // a search term with an accent in it has to survive the trip.
    const frame = encodeSimfarmText({ streamId: 0, text: 'é' });
    expect([...frame.subarray(3)]).toEqual([0xc3, 0xa9]);
  });
});

describe('encodeSimfarmControl', () => {
  test('is JSON on its own channel', () => {
    const frame = encodeSimfarmControl({ id: 4, op: 'attach', deviceId: 'ios:x', codec: 'jpeg' });
    expect(frame[0]).toBe(SIMFARM_CHANNEL.CONTROL);
    expect(JSON.parse(Buffer.from(frame.subarray(1)).toString('utf8'))).toEqual({
      id: 4,
      op: 'attach',
      deviceId: 'ios:x',
      codec: 'jpeg',
    });
  });
});

describe('encodeSimfarmBoot', () => {
  test('is the provider-level op from PROTOCOL.md: a device, not a stream', () => {
    const frame = encodeSimfarmBoot({ id: 9, deviceId: 'ios:abc' });
    expect(frame[0]).toBe(SIMFARM_CHANNEL.CONTROL);
    expect(JSON.parse(Buffer.from(frame.subarray(1)).toString('utf8'))).toEqual({
      id: 9,
      op: 'boot',
      deviceId: 'ios:abc',
    });
  });

  test('waits as long as the server does', () => {
    // simfarm's iOS provider gives `simctl bootstatus` 180s before it answers
    // `ok:false`. A shorter client deadline abandons a boot the server is
    // about to finish; a longer one outlives a server that stopped answering.
    expect(SIMFARM_BOOT_TIMEOUT_MS).toBe(180_000);
  });
});

describe('readSimfarmControlReply', () => {
  test('sorts an answer into ok and not, keeping the id and the body', () => {
    expect(readSimfarmControlReply({ id: 3, ok: true, result: { ok: true } })).toEqual({
      id: 3,
      ok: true,
      body: { id: 3, ok: true, result: { ok: true } },
    });
    expect(readSimfarmControlReply({ id: 3, ok: false, error: 'no such device' })).toEqual({
      id: 3,
      ok: false,
      error: 'no such device',
    });
  });

  test('a failure with no words still has a sentence, and a missing ok is not a success', () => {
    expect(readSimfarmControlReply({ id: 1, ok: false })).toEqual({
      id: 1,
      ok: false,
      error: 'failed',
    });
    expect(readSimfarmControlReply({ id: 1, ok: false, error: '' })).toMatchObject({
      error: 'failed',
    });
    expect(readSimfarmControlReply({ id: 1, result: {} })).toMatchObject({ ok: false });
  });

  test('an answer with no id answers nothing', () => {
    expect(readSimfarmControlReply({ ok: true })).toBeNull();
    expect(readSimfarmControlReply({ id: '4', ok: true })).toBeNull();
  });
});

describe('decodeSimfarmFrame', () => {
  const bytes = (values: number[]) => Uint8Array.from(values).buffer;

  test('reads a video frame and hands the payload back untouched', () => {
    const frame = decodeSimfarmFrame(bytes([0x01, 5, SIMFARM_VIDEO_TAG.KEY, 0xff, 0xd8, 0xff]));
    expect(frame).toEqual({
      channel: 'video',
      streamId: 5,
      tag: SIMFARM_VIDEO_TAG.KEY,
      payload: Uint8Array.from([0xff, 0xd8, 0xff]),
    });
  });

  test('tells a control answer from a pushed event', () => {
    const control = decodeSimfarmFrame(json(SIMFARM_CHANNEL.CONTROL, { id: 1, ok: true }));
    const event = decodeSimfarmFrame(json(SIMFARM_CHANNEL.EVENT, { ev: 'screen', width: 1206 }));
    expect(control).toEqual({ channel: 'control', body: { id: 1, ok: true } });
    expect(event).toEqual({ channel: 'event', body: { ev: 'screen', width: 1206 } });
  });

  test('reads a device name that is not ASCII, at every UTF-8 width', () => {
    // Device names come from another machine and are whatever that machine
    // calls its simulators. Two, three and four byte sequences in one string,
    // because the four-byte case is a surrogate pair on the way out and is the
    // one a hand-rolled decoder gets wrong.
    const name = 'Süd \u20ac \ud83d\ude42';
    const frame = decodeSimfarmFrame(json(SIMFARM_CHANNEL.EVENT, { ev: 'devices', n: name }));
    expect(frame).toEqual({ channel: 'event', body: { ev: 'devices', n: name } });
  });

  test('is null on anything it cannot use, and never throws', () => {
    for (const input of [
      bytes([]),
      bytes([0x01]),
      // A video frame with no tag.
      bytes([0x01, 0x00]),
      // A channel from a later protocol.
      bytes([0x09, 0x01, 0x02]),
      // JSON that parses but is not an object.
      json(SIMFARM_CHANNEL.EVENT, [1, 2, 3]),
      json(SIMFARM_CHANNEL.CONTROL, 'a string'),
      // Not JSON at all.
      bytes([SIMFARM_CHANNEL.EVENT, 0x7b, 0x7b, 0x7b]),
    ]) {
      expect(decodeSimfarmFrame(input)).toBeNull();
    }
  });

  test('a truncated multi-byte character becomes a replacement, not a throw', () => {
    // Half a character can arrive at the end of any buffer. The frame is worth
    // keeping; the character is not worth failing over.
    const frame = decodeSimfarmFrame(
      Uint8Array.from([
        SIMFARM_CHANNEL.EVENT,
        ...Buffer.from('{"ev":"x","n":"a'),
        0xe6,
        0x89,
        0x22,
        0x7d,
      ]).buffer
    );
    expect(frame?.channel).toBe('event');
    expect(typeof (frame as unknown as { body: { n: unknown } }).body.n).toBe('string');
  });
});

function json(channel: number, body: unknown): ArrayBuffer {
  const text = Buffer.from(JSON.stringify(body), 'utf8');
  return Uint8Array.from([channel, ...text]).buffer;
}
