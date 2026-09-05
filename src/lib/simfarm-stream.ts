/**
 * The socket behind the preview: one WebSocket, one attached device, one
 * picture, and the four kinds of input that go back the other way.
 *
 * `simfarm-protocol.ts` is the bytes and `simfarm-frame.ts` is the arithmetic;
 * this is the part that has to hold a connection open, and it is separated from
 * both for the reason the rest of this feature is: the two pure files are worth
 * pinning exactly, and pinning them must not need a socket.
 *
 * ## Why the frames are jpeg and drawn with Skia
 *
 * simfarm offers h264 and jpeg. Hermes has no video decoder, so jpeg is the
 * only one this app can draw -- and it is not the poor relation it sounds like:
 * simfarm's own browser client silently drops to jpeg whenever `VideoDecoder`
 * is missing, which over a plain-http tailnet is every time. Each frame is a
 * whole image, so there is no decoder state to keep, nothing to resynchronise
 * after a dropped frame, and a stream that survives being backgrounded.
 *
 * Skia rather than an `Image` with a data URI, because the app already draws
 * its terminal with Skia and because the alternative is worse work: the bytes
 * would have to be base64-encoded again, at about 1.5 MB a second, to be handed
 * back to a component that would decode them a third time.
 *
 * ## What it deliberately does not do
 *
 * It does not reconnect, on its own or on request. A socket that dropped is
 * reported as dropped and the caller starts again -- which in practice means
 * the probe runs and a fresh hook opens a fresh socket, because the probe is
 * the thing that can tell "simfarm has gone" from "the connection blipped" and
 * this cannot. A retry in here would be a second, worse answer to a question
 * already answered next door -- and a preview quietly reattaching to a machine
 * nobody is looking at is not a behaviour worth having either.
 */
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  parseSimfarmDevices,
  SIMFARM_CODEC,
  simfarmCanStream,
  type SimfarmDevice,
} from '@/lib/simfarm';
import {
  decodeSimfarmFrame,
  encodeSimfarmButton,
  encodeSimfarmControl,
  encodeSimfarmText,
  encodeSimfarmTouch,
  SIMFARM_TOUCH_PHASE,
  SIMFARM_VIDEO_TAG,
  type SimfarmButton,
  type SimfarmEdge,
  type SimfarmTouchPhase,
} from '@/lib/simfarm-protocol';
import { simfarmEdgeAt } from '@/lib/simfarm-frame';

/**
 * Where the stream is, in the four states a reader can be told apart.
 *
 * `picking` is not an error and is why the list is a state rather than a
 * failure: a machine with two simulators booted has to be asked which one, and
 * a machine with none has a simfarm running with nothing on it -- both of them
 * are "no picture yet" for reasons no reconnection would fix.
 */
export type SimfarmStreamStatus = 'connecting' | 'picking' | 'attaching' | 'live' | 'lost';

/** The picture's size and which way up the frames arrive; see PROTOCOL §6. */
export interface SimfarmStreamScreen {
  width: number;
  height: number;
  scale: number;
  /** Degrees clockwise the decoded frame needs before it is upright. */
  rotation: 0 | 90 | 180 | 270;
}

export interface SimfarmStream {
  status: SimfarmStreamStatus;
  devices: SimfarmDevice[];
  device: SimfarmDevice | null;
  screen: SimfarmStreamScreen | null;
  image: SkImage | null;
  /** Attach to a device, replacing whatever is attached now. */
  attach: (deviceId: string) => void;
  touch: (input: { phase: SimfarmTouchPhase; x: number; y: number }) => void;
  type: (text: string) => void;
  press: (button: SimfarmButton) => void;
}

/**
 * A live picture of one device on `url`, and the way back to it.
 *
 * `seed` is what the probe already learned, so the picker has a list before the
 * socket has said anything -- the alternative is a spinner on a screen that is
 * about to be a list of two, which reads as slower than it is.
 */
export function useSimfarmStream(url: string | null, seed: SimfarmDevice[]): SimfarmStream {
  const [status, setStatus] = useState<SimfarmStreamStatus>('connecting');
  const [devices, setDevices] = useState<SimfarmDevice[]>(seed);
  const [device, setDevice] = useState<SimfarmDevice | null>(null);
  const [screen, setScreen] = useState<SimfarmStreamScreen | null>(null);
  const [image, setImage] = useState<SkImage | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const streamId = useRef<number | null>(null);
  const nextId = useRef(1);
  const seq = useRef(0);
  /**
   * The edge the gesture in flight began at.
   *
   * Here rather than in the component for the same reason `seq` is: both live
   * for exactly one gesture and neither means anything between them. It is
   * decided at `begin` and repeated unchanged afterwards, because iOS only
   * recognises a system gesture that *started* at an edge and by the second
   * move that fact is no longer in the coordinates.
   */
  const edge = useRef<SimfarmEdge>('none');
  /**
   * Which request the attach answer belongs to, so a reply for a device the
   * reader has already moved on from cannot claim the stream. Reusing a
   * `streamId` after a detach is legal in the protocol, so "an attach answer
   * arrived" is not on its own enough to act on.
   */
  const pendingAttach = useRef<{ id: number; deviceId: string } | null>(null);
  /**
   * The device the reader asked for, kept out of React state on purpose: it is
   * read inside the socket's own callbacks, which close over the render they
   * were created in.
   */
  const wanted = useRef<string | null>(null);
  // Skia images are native memory with a JS handle. Dropping one without
  // disposing it leaks a whole frame, and at six frames a second that is
  // visible in minutes rather than hours.
  const shown = useRef<SkImage | null>(null);

  /**
   * Let go of the frame on screen.
   *
   * A named callback rather than the body of an unmount effect, because the
   * effect's cleanup may not reach into a ref: by the time a cleanup runs the
   * ref can already point at something else. Here it points at exactly what
   * this is meant to free, and going through a stable callback says so.
   */
  const dropImage = useCallback(() => {
    shown.current?.dispose();
    shown.current = null;
  }, []);

  const showImage = useCallback((next: SkImage | null) => {
    const previous = shown.current;
    shown.current = next;
    setImage(next);
    previous?.dispose();
  }, []);

  /**
   * Let go of a socket, detaching first if there is still a stream on it.
   *
   * A callback rather than the body of the effect's cleanup, for the reason
   * `dropImage` is one: a cleanup may not reach into a ref, because by the time
   * it runs the ref can already be pointing at the next connection.
   */
  const releaseStream = useCallback((live: WebSocket) => {
    const held = streamId.current;
    // Best effort: a detach on a socket already on its way down is a no-op,
    // and the server drops the stream when the connection goes anyway.
    if (held !== null && live.readyState === 1) {
      live.send(encodeSimfarmControl({ id: nextId.current++, op: 'detach', streamId: held }));
    }
    streamId.current = null;
    pendingAttach.current = null;
    live.close();
    socket.current = null;
  }, []);

  const send = useCallback((bytes: Uint8Array) => {
    const live = socket.current;
    if (!live || live.readyState !== 1) return;
    live.send(bytes);
  }, []);

  const request = useCallback(
    (op: string, extra: Record<string, unknown> = {}): number => {
      const id = nextId.current++;
      send(encodeSimfarmControl({ id, op, ...extra }));
      return id;
    },
    [send]
  );

  const attach = useCallback(
    (deviceId: string) => {
      wanted.current = deviceId;
      const held = streamId.current;
      streamId.current = null;
      showImage(null);
      setScreen(null);
      setStatus('attaching');
      // Detach first, so a machine driving two simulators is not left encoding
      // a picture nobody is looking at.
      if (held !== null) request('detach', { streamId: held });
      pendingAttach.current = {
        id: request('attach', { deviceId, codec: SIMFARM_CODEC }),
        deviceId,
      };
    },
    [request, showImage]
  );

  useEffect(() => {
    if (url === null) {
      setStatus('lost');
      return;
    }

    let closed = false;
    setStatus('connecting');
    const live = new WebSocket(url);
    live.binaryType = 'arraybuffer';
    socket.current = live;

    live.onopen = () => {
      // The server pushes `devices` on its own, so there is nothing to ask for
      // here; what the probe found already stands in until it arrives.
      if (wanted.current !== null) attach(wanted.current);
    };

    live.onmessage = (event: { data: unknown }) => {
      const data = event.data;
      if (typeof data === 'string' || !(data instanceof ArrayBuffer)) return;
      const frame = decodeSimfarmFrame(data);
      if (frame === null) return;

      if (frame.channel === 'video') {
        if (frame.streamId !== streamId.current) return;
        if (frame.tag !== SIMFARM_VIDEO_TAG.SEED && frame.tag !== SIMFARM_VIDEO_TAG.KEY) return;
        // `slice`, not the view: the payload borrows the socket message's
        // buffer, and Skia holds the bytes for as long as the image lives.
        const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(frame.payload.slice()));
        if (decoded === null) return;
        showImage(decoded);
        setStatus('live');
        return;
      }

      if (frame.channel === 'event') {
        const kind = frame.body.ev;
        if (kind === 'devices') {
          const listed = parseSimfarmDevices(frame.body);
          setDevices(listed);
          if (wanted.current === null) {
            const first = listed.find((entry) => entry.booted && simfarmCanStream(entry));
            if (first) attach(first.id);
            else setStatus('picking');
          }
          return;
        }
        if (kind === 'screen' && frame.body.streamId === streamId.current) {
          setScreen(readScreen(frame.body));
        }
        return;
      }

      const pending = pendingAttach.current;
      if (pending === null || frame.body.id !== pending.id) return;
      pendingAttach.current = null;
      if (frame.body.ok !== true || typeof frame.body.streamId !== 'number') {
        setStatus('picking');
        return;
      }
      streamId.current = frame.body.streamId;
      const attached = parseSimfarmDevices({ devices: [frame.body.device] })[0];
      if (attached) setDevice(attached);
      const reported = readScreen(frame.body.device);
      if (reported) setScreen(reported);
    };

    live.onerror = () => {
      if (!closed) setStatus('lost');
    };
    live.onclose = () => {
      if (!closed) setStatus('lost');
    };

    return () => {
      closed = true;
      releaseStream(live);
    };
  }, [attach, releaseStream, showImage, url]);

  // The last frame outlives the socket by one render otherwise, and a native
  // buffer nobody can reach is the definition of a leak.
  useEffect(() => dropImage, [dropImage]);

  const touch = useCallback<SimfarmStream['touch']>(
    (input) => {
      const id = streamId.current;
      if (id === null) return;
      if (input.phase === SIMFARM_TOUCH_PHASE.BEGIN) {
        edge.current = simfarmEdgeAt({ x: input.x, y: input.y });
      }
      send(
        encodeSimfarmTouch({
          streamId: id,
          phase: input.phase,
          x: input.x,
          y: input.y,
          seq: seq.current++ & 0xffff,
          edge: edge.current,
        })
      );
      if (input.phase === SIMFARM_TOUCH_PHASE.END) edge.current = 'none';
    },
    [send]
  );

  const type = useCallback(
    (text: string) => {
      const id = streamId.current;
      if (id === null || text === '') return;
      send(encodeSimfarmText({ streamId: id, text }));
    },
    [send]
  );

  const press = useCallback(
    (button: SimfarmButton) => {
      const id = streamId.current;
      if (id === null) return;
      send(encodeSimfarmButton({ streamId: id, button, down: true }));
      send(encodeSimfarmButton({ streamId: id, button, down: false }));
    },
    [send]
  );

  return useMemo(
    () => ({ status, devices, device, screen, image, attach, touch, type, press }),
    [attach, device, devices, image, press, screen, status, touch, type]
  );
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
