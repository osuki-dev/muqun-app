/**
 * The socket behind the preview: one WebSocket, one attached device, one
 * picture, and the four kinds of input that go back the other way.
 *
 * `simfarm-protocol.ts` is the bytes, `simfarm-frame.ts` is the arithmetic,
 * `simfarm-session.ts` is the state machine and `simfarm-session-cache.ts` is
 * the lifetime; this is the part that has to open a real socket and hold a
 * native image alive, and it is separated from all four for the reason the
 * rest of this feature is: the pure files are worth pinning exactly, and
 * pinning them must not need a socket, Skia or a UI runtime.
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
 * ## Why a frame never goes through React
 *
 * It used to: each frame was `setImage`, a render of the stage, a commit, and
 * a re-walk of the Skia tree to record a new picture. Measured on the
 * emulator that was 50-60 ms of JS thread per frame in a debug build, the JS
 * thread two-thirds busy at ten frames a second, and half of the frames
 * arriving never reaching a commit at all because the socket's own work kept
 * starving the scheduler. None of it drew anything different: the tree is
 * the same tree with a different image in one node.
 *
 * So the image is a shared value. Skia reads it on the UI runtime and
 * re-records the picture there when it changes, and the stage is not
 * rendered again -- what reaches React is the one bit it draws by, whether
 * there is a picture at all. What is left on the JS thread per frame is the
 * socket's base64 decode (the platform's, not ours), a header parse, and the
 * creation of a lazily-decoded image handle: the JPEG itself is decoded at
 * draw time on the render thread, which is also why nothing here decodes it.
 *
 * ## Why a frame is disposed on the UI runtime, and three frames late
 *
 * A Skia image is native memory with a JS handle, and dropping the handle
 * does not free it; `dispose` does. Disposing the previous frame the moment
 * the next arrives emptied the very image the UI runtime was about to record
 * -- the picture went blank while the state said `live`, which the emulator
 * showed every time -- so `simfarm-frame-ring.ts` holds the last few and
 * hands back the one that fell off the end, and *that* is disposed in the
 * same UI-runtime job that installs the newest frame. The job runs after the
 * jobs that installed the frames in between, and Skia records each installed
 * frame in a microtask right behind its job, so by the time a frame is
 * disposed it has been recorded and superseded. The ring's depth is slack on
 * top of that ordering, not a substitute for it.
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
import { AppState } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { type SimfarmDevice } from '@/lib/simfarm';
import { type SimfarmEdgeBands } from '@/lib/simfarm-frame';
import { SimfarmFrameRing } from '@/lib/simfarm-frame-ring';
import { type SimfarmButton, type SimfarmTouchPhase } from '@/lib/simfarm-protocol';
import {
  initialSimfarmSessionState,
  type SimfarmSession,
  type SimfarmSessionState,
} from '@/lib/simfarm-session';
import { SimfarmSessionCache } from '@/lib/simfarm-session-cache';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

export type {
  SimfarmStreamError,
  SimfarmStreamScreen,
  SimfarmStreamStatus,
} from '@/lib/simfarm-session';

/** How many frames are kept alive behind the one on screen; see the note above. */
const SIMFARM_FRAME_RING = 3;

export interface SimfarmStream extends SimfarmSessionState {
  /**
   * The frame to draw, for the UI runtime. Hand it to Skia as a prop; never
   * read it during a render, which is what `hasImage` is for.
   */
  image: SharedValue<SkImage | null>;
  /** Whether there is a frame on screen -- the one bit of the picture React draws by. */
  hasImage: boolean;
  /** Show a device: attach if it is running, start it first if it is not. */
  select: (deviceId: string) => void;
  /** Turn a device off, letting go of it first if it is the one on screen. */
  shutdown: (deviceId: string) => void;
  touch: (input: {
    phase: SimfarmTouchPhase;
    x: number;
    y: number;
    bands?: SimfarmEdgeBands;
  }) => void;
  type: (text: string) => void;
  press: (button: SimfarmButton) => void;
}

/** The socket for `url`, wired to `session`, for the cache to open. */
function openSocket(url: string, session: SimfarmSession): void {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  session.connect({
    get readyState() {
      return socket.readyState;
    },
    send: (bytes) => socket.send(bytes),
    close: () => socket.close(),
  });
  socket.onopen = () => session.opened();
  socket.onmessage = (event: { data: unknown }) => {
    const data = event.data;
    if (typeof data === 'string' || !(data instanceof ArrayBuffer)) return;
    session.received(data);
  };
  // A session that has already let go is told about a close it caused, and
  // takes no harm from it.
  socket.onerror = () => session.dropped();
  socket.onclose = () => session.dropped();
}

const cache = new SimfarmSessionCache({ open: openSocket });

/**
 * The two events after which an idle socket is not worth keeping: the app
 * leaving the screen, and the gateway -- the machine the sockets belong to --
 * changing under it. Installed once, the first time there is a socket to
 * watch over.
 */
let watching = false;
function watchOver(): void {
  if (watching) return;
  watching = true;
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') cache.closeIdle();
  });
  useGatewayConnectionStore.subscribe((state, previous) => {
    if (state.record?.url !== previous.record?.url) cache.closeIdle();
  });
}

/**
 * Open the socket for `url` now, ahead of the screen that will show it.
 *
 * Called from the tile that opens the preview, so the socket's round trips
 * run under the route's own mounting instead of after it, and from the probe,
 * so they run beside it instead of behind it. `null` is a gateway with no
 * address to build one from; `allowed` is the gate the probe applies, applied
 * here first -- a socket to a connection the preview may not be offered on
 * is exactly the thing the gate exists to prevent.
 */
export function warmSimfarm(url: string | null, allowed: boolean): void {
  if (url === null || !allowed) return;
  watchOver();
  cache.warm(url);
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
  const image = useSharedValue<SkImage | null>(null);
  const [hasImage, setHasImage] = useState(false);

  /**
   * The session behind the socket in flight, kept out of React state on
   * purpose: it is reached from callbacks that close over the render they were
   * created in, and it is replaced whenever the socket is.
   */
  const session = useRef<SimfarmSession | null>(null);

  useEffect(() => {
    if (url === null) {
      setState((current) => ({ ...current, status: 'lost' }));
      return;
    }
    watchOver();
    const hold = cache.acquire(url, seed);
    const { entry } = hold;
    session.current = entry.session;

    const ring = new SimfarmFrameRing<SkImage>(SIMFARM_FRAME_RING);
    // Whether the last frame handed over was a picture, so React is told
    // only when that changes and not eight times a second.
    let showing = false;
    const show = (payload: Uint8Array | null) => {
      if (payload === null) {
        const stale = ring.drain();
        scheduleOnUI(() => {
          'worklet';
          image.value = null;
          for (const held of stale) held.dispose();
        });
        if (showing) {
          showing = false;
          setHasImage(false);
        }
        return;
      }
      // Lazy: the handle is made here, the JPEG is decoded where it is drawn.
      const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(payload));
      if (decoded === null) return;
      const stale = ring.push(decoded);
      scheduleOnUI(() => {
        'worklet';
        image.value = decoded;
        if (stale !== null) stale.dispose();
      });
      if (!showing) {
        showing = true;
        setHasImage(true);
      }
    };
    // The frame a kept session already has, so a reopened preview draws it at
    // its first layout and the stream takes over from there.
    if (entry.lastFrame !== null) show(entry.lastFrame);
    const stopFrames = entry.onFrame(show);
    setState(entry.session.getState());
    const stopState = entry.session.subscribe(setState);

    return () => {
      stopFrames();
      stopState();
      if (session.current === entry.session) session.current = null;
      // The session keeps its own copy of the last frame; the images made
      // from it here are this screen's, and go with it.
      show(null);
      hold.release();
    };
  }, [image, seed, url]);

  const select = useCallback((deviceId: string) => session.current?.select(deviceId), []);
  const shutdown = useCallback((deviceId: string) => session.current?.shutdown(deviceId), []);
  const touch = useCallback<SimfarmStream['touch']>((input) => session.current?.touch(input), []);
  const type = useCallback((text: string) => session.current?.type(text), []);
  const press = useCallback((button: SimfarmButton) => session.current?.press(button), []);

  return useMemo(
    () => ({ ...state, image, hasImage, select, shutdown, touch, type, press }),
    [hasImage, image, press, select, shutdown, state, touch, type]
  );
}
