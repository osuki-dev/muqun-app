/**
 * What the pairing aperture is currently reading, and what it should therefore
 * draw.
 *
 * The scan step used to answer this in three places at once: the route decided
 * whether the camera was allowed to run, `PairingCamera` decided which of its
 * own fallbacks to show, and the reticle decided whether to breathe -- so the
 * emulator ended up telling the reader to "align the QR inside the frame"
 * underneath the words "camera unavailable", and the seconds between a code
 * being seen and the gateway answering looked identical to nothing happening.
 *
 * One reading, derived once, is what lets the aperture draw exactly one thing.
 */

export type ScanReading =
  /** A code is in hand and the gateway is being asked about it. */
  | 'claiming'
  /** A code is in frame and has been accepted; the request is on its way. */
  | 'found'
  /** No lens to look through: no camera, a camera that failed, or web. */
  | 'unavailable'
  /** There is a camera, but this app has not been allowed to use it yet. */
  | 'permission'
  /**
   * Allowed, and the platform has not finished saying which lenses exist. A
   * second of it on a cold start, and it used to be indistinguishable from
   * having no camera at all -- so the aperture opened by announcing a fault
   * that was about to resolve itself.
   */
  | 'warming'
  /** The last code was refused, and the guard is holding off a re-read. */
  | 'rejected'
  /** Live pixels from the rear lens, looking for a code. */
  | 'aiming'
  /**
   * Live pixels from the front lens, because there is no rear one.
   *
   * A QR held up to the screen scans perfectly well through the selfie camera.
   * Insisting on the rear lens turned a device that could still pair into a
   * dead end, which is a worse answer than an inverted preview.
   */
  | 'aiming-front';

/**
 * Which lens the platform has actually resolved.
 *
 * The reason this is not a boolean: `useCameraDevice(position)` returns
 * `undefined` both while vision-camera's device factory is still resolving --
 * it is a promise hook, and `undefined` is what it yields before the native
 * factory answers -- and when the factory has answered and there is no such
 * lens. Folding those two into one `hasDevice` flag is what let a slow
 * enumeration render as a permanent "this device has no rear camera".
 */
/** A lens position a scanner can be pointed at. */
export type LensPosition = 'back' | 'front';

export type LensReading =
  /** The device factory has not answered yet. Not an answer, and not a fault. */
  | 'pending'
  | LensPosition
  /** Enumerated, and there is no lens this app can scan through. */
  | 'none';

export type LensReadingInput = {
  hasBackLens: boolean;
  /** A front lens this platform's scanner can actually be pointed at. */
  hasFrontLens: boolean;
  /** How many lenses the platform has enumerated, of any position. */
  lensCount: number;
  /**
   * An empty lens list has been given long enough to stop meaning "not yet".
   * Only consulted while the list is empty, because a list with anything in it
   * has already proved the enumeration finished.
   */
  settled: boolean;
};

/**
 * What the platform has established about the lenses, from evidence first and
 * the clock only as a last resort.
 *
 * A non-empty device list is proof the enumeration finished, so the usual case
 * needs no timer at all and cannot be raced by one. The timer survives for the
 * one case evidence cannot settle: an empty list looks the same whether the
 * factory has not answered or the device genuinely has no cameras.
 */
export function pairingLensReading(input: LensReadingInput): LensReading {
  if (input.hasBackLens) return 'back';
  if (input.lensCount > 0) return input.hasFrontLens ? 'front' : 'none';
  return input.settled ? 'none' : 'pending';
}

export type ScanReadingInput = {
  /** Web has no camera path at all in this app. */
  isWeb: boolean;
  hasPermission: boolean;
  lens: LensReading;
  /** The native camera reported a failure. */
  cameraError: boolean;
  /**
   * A camera was mounted and never produced a picture.
   *
   * Distinct from `cameraError`, and deliberately powerless until there is a
   * lens: a preview cannot be late before there is anything to preview, and
   * treating it as a fault regardless is what spent the first-frame budget on
   * the permission dialog and then blamed the hardware for it.
   */
  previewTimedOut: boolean;
  /** A code was read and accepted. */
  detected: boolean;
  /** A pairing request is in flight. */
  busy: boolean;
  /**
   * The last read was refused and the 2500 ms re-fire guard has not expired.
   * Without this the same QR is still in frame, so scan -> fail -> scan loops.
   */
  rejected: boolean;
};

/**
 * The single reading, in precedence order.
 *
 * What is happening beats what is possible: a request in flight and a code in
 * frame are both things the reader is waiting on, and they outrank the question
 * of whether the lens works. Below those, permission is asked before the device
 * is blamed -- a lens the app was never allowed to open reports as absent on
 * some Android builds, and on iOS the discovery session enumerates nothing at
 * all until the grant, so "allow camera" is the useful thing to say either way.
 *
 * `pending` outranks every fault below it. A lens that has not answered has not
 * failed, and there is no reading it can be given other than "still asking".
 */
export function pairingScanReading(input: ScanReadingInput): ScanReading {
  if (input.busy) return 'claiming';
  if (input.detected) return 'found';
  if (input.isWeb) return 'unavailable';
  if (!input.hasPermission) return 'permission';
  if (input.cameraError) return 'unavailable';
  if (input.lens === 'pending') return 'warming';
  if (input.lens === 'none') return 'unavailable';
  if (input.previewTimedOut) return 'unavailable';
  if (input.rejected) return 'rejected';
  return input.lens === 'front' ? 'aiming-front' : 'aiming';
}

/** Live pixels, whichever way the lens faces. */
export function isAimingReading(reading: ScanReading): boolean {
  return reading === 'aiming' || reading === 'aiming-front';
}

/**
 * Why the aperture gave up, for the one state that has to explain itself.
 *
 * "No camera to scan with" was true of four different situations and useful in
 * none of them, and on hardware the team does not own it is also the only
 * diagnostic channel there is: the reader describing their screen is the whole
 * bug report. So the unavailable state names its cause.
 */
export type ScanFault =
  /** No camera path in this app at all. */
  | 'web'
  /** The platform enumerated its lenses and none of them can be scanned with. */
  | 'no-lens'
  /** A lens exists, was mounted, and never delivered a picture. */
  | 'preview-never-started'
  /** The native camera raised an error. */
  | 'camera-error';

export function pairingScanFault(input: ScanReadingInput): ScanFault | null {
  if (pairingScanReading(input) !== 'unavailable') return null;
  if (input.isWeb) return 'web';
  if (input.cameraError) return 'camera-error';
  if (input.lens === 'none') return 'no-lens';
  return 'preview-never-started';
}

export type ScanRequestInput = {
  cameraError: boolean;
  detected: boolean;
  busy: boolean;
  rejected: boolean;
};

/**
 * The route's half, folded over the reading the camera chunk handed up.
 *
 * The permission and lens facts only exist inside the lazily loaded camera
 * chunk, and the request facts only exist in the route. This used to be
 * reconciled by rebuilding a whole `ScanReadingInput` out of the child's
 * reading -- inferring `hasDevice` from "the child did not say unavailable" --
 * which quietly aliased four lens states onto two booleans and could only ever
 * be as accurate as the reading it was reverse-engineering.
 */
export function pairingScanReadingWithRequest(
  lensReading: ScanReading,
  request: ScanRequestInput
): ScanReading {
  if (request.busy) return 'claiming';
  if (request.detected) return 'found';
  if (request.cameraError) return 'unavailable';
  if (request.rejected && isAimingReading(lensReading)) return 'rejected';
  return lensReading;
}

/**
 * The backstop for an empty lens list, once the device factory's own promise
 * has failed to arrive at all.
 *
 * Not the mechanism. Whether the enumeration has finished is answered exactly,
 * by awaiting the promise vision-camera builds its device factory from; this
 * only covers a bridge that never answers either way, so that a hung native
 * module ends in a stated fault rather than a spinner with no way out.
 *
 * The previous budget was one second, and it *was* the mechanism -- reasoned
 * from how fast CameraX answers, which skipped the step where the answer has to
 * cross a promise first. An emulator was measured taking over four seconds, so
 * a clock tuned to the enumeration flashed "no camera" before recovering. Long
 * enough here that nothing healthy can reach it, because being early is the
 * whole bug and being late only costs an honest spinner.
 */
export const LENS_SETTLE_MS = 15000;

/**
 * How long the reactive device list is given to publish after the factory it
 * comes from has answered.
 *
 * The aperture awaits its own `createDeviceFactory()` promise, which is not the
 * instance `useCameraDevices` subscribes to, so the two can land a frame or two
 * apart. This covers that gap and nothing else: on any device with a lens the
 * list is already non-empty and the question never arises.
 */
export const LENS_PUBLISH_GRACE_MS = 1000;

/**
 * How long a mounted camera is given to produce its first frame before the
 * aperture stops waiting on it.
 *
 * A preview that never starts is indistinguishable from a preview that is about
 * to, and the difference matters: one is a beat, the other is a screen that sits
 * empty forever.
 *
 * This clock may only run while a camera is actually mounted. It used to start
 * with the screen, so the permission dialog and the enumeration spent a budget
 * meant for the sensor, and the aperture reported a first frame as overdue
 * before anything existed that could have produced one.
 */
export const PREVIEW_START_TIMEOUT_MS = 2500;

/**
 * The aperture's own geometry.
 *
 * Square, and that is the whole rule. A QR code is square, the mark this frame
 * draws is square, and the home screen's two smaller instances of it are square:
 * letting the frame stretch to whatever column it is given made a tablet show a
 * 755x418 letterbox with corner brackets pinned to corners the mark never had.
 * The cap is what keeps it a viewfinder rather than a wall -- past a point, a
 * bigger frame does not help anyone aim, it just leaves the copy inside it
 * stranded in the middle of an acre.
 */
export const APERTURE_MAX_SIZE = 460;

export function pairingApertureSize(contentWidth: number): number {
  const safeWidth = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  return Math.min(safeWidth, APERTURE_MAX_SIZE);
}

export type ScanPresentation = {
  reading: ScanReading;
  /**
   * Camera pixels are filling the aperture, so anything drawn on top is drawn
   * over an image this app does not control. That is the one place in the
   * product where a theme token cannot decide a colour, and the only reason
   * the overlay ink is fixed rather than themed.
   */
  showsPreview: boolean;
  /** The aiming frame, which only means anything over pixels being aimed. */
  showsReticle: boolean;
  /** The reticle has closed on a code and stops breathing. */
  reticleClosed: boolean;
  /**
   * Scanning cannot get this reader to a paired server, so the manual route
   * stops being the alternative and becomes the recommendation. The control is
   * the same one either way -- it just stops being quiet.
   */
  promotesManualEntry: boolean;
  /** The aperture is waiting on the gateway rather than on the reader. */
  isWaiting: boolean;
};

export function pairingScanPresentation(reading: ScanReading): ScanPresentation {
  const showsPreview = isAimingReading(reading) || reading === 'found' || reading === 'rejected';
  // `warming` deliberately promotes nothing and says nothing: an empty frame is
  // the honest reading of a lens that has not answered yet, and a recommendation
  // made a second before it resolves is a recommendation the reader has to undo.
  return {
    reading,
    showsPreview,
    showsReticle: showsPreview,
    reticleClosed: reading === 'found',
    promotesManualEntry: reading === 'unavailable' || reading === 'permission',
    isWaiting: reading === 'claiming',
  };
}

/**
 * How long a refused code is ignored for.
 *
 * The QR is still in frame when the gateway says no, so an immediately re-armed
 * reader reads the same bad code on the next frame and the screen flickers
 * between "found" and an error for as long as the phone is held there.
 */
export const SCAN_REJECT_HOLD_MS = 2500;

/**
 * How long the install command's copy button says it copied.
 *
 * Long enough to be read after the eyes come back from the laptop the paste is
 * going into, short enough that a reader who returns to this screen later is
 * not told about a clipboard write they no longer remember making.
 */
export const COPIED_HOLD_MS = 2000;
