/**
 * The socket behind the preview: one WebSocket, one attached device, one
 * picture, and the four kinds of input that go back the other way.
 *
 * `simfarm-protocol.ts` is the bytes, `simfarm-frame.ts` is the arithmetic and
 * `simfarm-session.ts` is the state machine; this is the part that has to hold
 * a connection open and a native image alive, and it is separated from all
 * three for the reason the rest of this feature is: the pure files are worth
 * pinning exactly, and pinning them must not need a socket or Skia.
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

import { type SimfarmDevice } from '@/lib/simfarm';
import { type SimfarmButton, type SimfarmTouchPhase } from '@/lib/simfarm-protocol';
import {
  initialSimfarmSessionState,
  SimfarmSession,
  type SimfarmSessionState,
} from '@/lib/simfarm-session';

export type {
  SimfarmStreamError,
  SimfarmStreamScreen,
  SimfarmStreamStatus,
} from '@/lib/simfarm-session';

export interface SimfarmStream extends SimfarmSessionState {
  image: SkImage | null;
  /** Show a device: attach if it is running, start it first if it is not. */
  select: (deviceId: string) => void;
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
  const [state, setState] = useState<SimfarmSessionState>(() => initialSimfarmSessionState(seed));
  const [image, setImage] = useState<SkImage | null>(null);

  /**
   * The session behind the socket in flight, kept out of React state on
   * purpose: it is reached from callbacks that close over the render they were
   * created in, and it is replaced whenever the socket is.
   */
  const session = useRef<SimfarmSession | null>(null);
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

  useEffect(() => {
    if (url === null) {
      setState((current) => ({ ...current, status: 'lost' }));
      return;
    }

    const live = new SimfarmSession({
      seed,
      onFrame: (payload) => {
        if (payload === null) {
          showImage(null);
          return;
        }
        // `slice`, not the view: the payload borrows the socket message's
        // buffer, and Skia holds the bytes for as long as the image lives.
        const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(payload.slice()));
        if (decoded !== null) showImage(decoded);
      },
    });
    session.current = live;
    setState(live.getState());
    const unsubscribe = live.subscribe(setState);

    let closed = false;
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    live.connect({
      get readyState() {
        return socket.readyState;
      },
      send: (bytes) => socket.send(bytes),
      close: () => socket.close(),
    });
    socket.onopen = () => live.opened();
    socket.onmessage = (event: { data: unknown }) => {
      const data = event.data;
      if (typeof data === 'string' || !(data instanceof ArrayBuffer)) return;
      live.received(data);
    };
    socket.onerror = () => {
      if (!closed) live.dropped();
    };
    socket.onclose = () => {
      if (!closed) live.dropped();
    };

    return () => {
      closed = true;
      unsubscribe();
      live.release();
      if (session.current === live) session.current = null;
    };
  }, [seed, showImage, url]);

  // The last frame outlives the socket by one render otherwise, and a native
  // buffer nobody can reach is the definition of a leak.
  useEffect(() => dropImage, [dropImage]);

  const select = useCallback((deviceId: string) => session.current?.select(deviceId), []);
  const touch = useCallback<SimfarmStream['touch']>((input) => session.current?.touch(input), []);
  const type = useCallback((text: string) => session.current?.type(text), []);
  const press = useCallback((button: SimfarmButton) => session.current?.press(button), []);

  return useMemo(
    () => ({ ...state, image, select, touch, type, press }),
    [image, press, select, state, touch, type]
  );
}
