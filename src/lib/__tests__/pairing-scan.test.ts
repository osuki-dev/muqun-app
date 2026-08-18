import { describe, expect, test } from 'bun:test';

import {
  APERTURE_MAX_SIZE,
  type LensReading,
  pairingApertureSize,
  pairingLensReading,
  pairingScanFault,
  pairingScanPresentation,
  pairingScanReading,
  pairingScanReadingWithRequest,
  type ScanReadingInput,
} from '../pairing-scan';

const aiming: ScanReadingInput = {
  isWeb: false,
  hasPermission: true,
  lens: 'back',
  cameraError: false,
  previewTimedOut: false,
  detected: false,
  busy: false,
  rejected: false,
};

const everyLens: LensReading[] = ['pending', 'back', 'front', 'none'];

describe('pairingLensReading', () => {
  test('a back lens is a back lens, whatever the clock says', () => {
    expect(
      pairingLensReading({ hasBackLens: true, hasFrontLens: true, lensCount: 2, settled: false })
    ).toBe('back');
  });

  test('an enumerated list needs no timer to be believed', () => {
    // The list having anything in it is proof the enumeration finished, so a
    // front-only device resolves immediately rather than after a grace period.
    expect(
      pairingLensReading({ hasBackLens: false, hasFrontLens: true, lensCount: 1, settled: false })
    ).toBe('front');
    expect(
      pairingLensReading({ hasBackLens: false, hasFrontLens: false, lensCount: 3, settled: false })
    ).toBe('none');
  });

  test('an empty list is "not yet" until it has been given its grace period', () => {
    expect(
      pairingLensReading({ hasBackLens: false, hasFrontLens: false, lensCount: 0, settled: false })
    ).toBe('pending');
    expect(
      pairingLensReading({ hasBackLens: false, hasFrontLens: false, lensCount: 0, settled: true })
    ).toBe('none');
  });

  test('a lens that arrives late still resolves after the clock gave up', () => {
    // The settle timer is monotonic, so this is the state a slow enumeration
    // lands in. Evidence has to beat the stopwatch or the verdict is permanent.
    expect(
      pairingLensReading({ hasBackLens: true, hasFrontLens: false, lensCount: 1, settled: true })
    ).toBe('back');
  });
});

describe('pairingScanReading', () => {
  test('reads a working, allowed camera as aiming', () => {
    expect(pairingScanReading(aiming)).toBe('aiming');
  });

  test('scans through the front lens rather than dead-ending', () => {
    expect(pairingScanReading({ ...aiming, lens: 'front' })).toBe('aiming-front');
  });

  test('asks for permission before blaming the device', () => {
    // Android can report no back-facing device for a camera this app was never
    // allowed to open, and iOS enumerates nothing at all before the grant.
    for (const lens of everyLens) {
      expect(pairingScanReading({ ...aiming, hasPermission: false, lens })).toBe('permission');
    }
  });

  test('reads a lens that does not exist as unavailable', () => {
    expect(pairingScanReading({ ...aiming, lens: 'none' })).toBe('unavailable');
  });

  test('never calls a lens absent while the platform is still enumerating', () => {
    // The bug this card exists for. `useCameraDevice` returns `undefined` both
    // while vision-camera's device factory is resolving and when there is no
    // such lens, and the first of those must never print as the second.
    expect(pairingScanReading({ ...aiming, lens: 'pending' })).toBe('warming');
    expect(pairingScanReading({ ...aiming, lens: 'pending', previewTimedOut: true })).toBe(
      'warming'
    );
    expect(pairingScanReading({ ...aiming, lens: 'pending', rejected: true })).toBe('warming');
  });

  test('a first frame cannot be overdue before there is a lens to produce one', () => {
    // The iPad failure in one assertion: the permission dialog and the
    // enumeration used to spend the sensor's budget, and the aperture then
    // reported the timeout as proof the hardware was missing.
    expect(pairingScanReading({ ...aiming, lens: 'pending', previewTimedOut: true })).not.toBe(
      'unavailable'
    );
    expect(
      pairingScanFault({ ...aiming, lens: 'pending', previewTimedOut: true })
    ).toBeNull();
  });

  test('a mounted preview that never starts is unavailable', () => {
    expect(pairingScanReading({ ...aiming, previewTimedOut: true })).toBe('unavailable');
    expect(pairingScanReading({ ...aiming, lens: 'front', previewTimedOut: true })).toBe(
      'unavailable'
    );
  });

  test('a camera that failed is unavailable whatever the lens is doing', () => {
    for (const lens of everyLens) {
      expect(pairingScanReading({ ...aiming, cameraError: true, lens })).toBe('unavailable');
    }
  });

  test('has no camera path on web at all', () => {
    expect(pairingScanReading({ ...aiming, isWeb: true, hasPermission: false })).toBe(
      'unavailable'
    );
    expect(pairingScanReading({ ...aiming, isWeb: true })).toBe('unavailable');
  });

  test('holds a refused code rather than re-reading it', () => {
    expect(pairingScanReading({ ...aiming, rejected: true })).toBe('rejected');
    expect(pairingScanReading({ ...aiming, lens: 'front', rejected: true })).toBe('rejected');
  });

  test('a code in frame outranks the state of the lens', () => {
    expect(pairingScanReading({ ...aiming, detected: true, lens: 'none' })).toBe('found');
  });

  test('a request in flight outranks everything, including a code in frame', () => {
    expect(pairingScanReading({ ...aiming, detected: true, busy: true })).toBe('claiming');
  });
});

describe('the Samsung tablet the team cannot plug in', () => {
  /**
   * The reported sequence, walked as state rather than asserted as a snapshot.
   *
   * The reporter's tablet has a working rear camera -- they take photos with it
   * in this same app -- and the scan step told them it had none, permanently.
   * Every step below is a moment that used to read `unavailable`, and the only
   * claim these assertions make is that none of them do now.
   */
  const walk = (over: Partial<ScanReadingInput>) => pairingScanReading({ ...aiming, ...over });

  test('the permission dialog is not evidence about the hardware', () => {
    // Seconds spent reading a system prompt, during which nothing has been
    // asked to produce a frame. The old first-frame clock ran throughout.
    expect(walk({ hasPermission: false, lens: 'pending' })).toBe('permission');
    expect(walk({ hasPermission: false, lens: 'pending', previewTimedOut: true })).toBe(
      'permission'
    );
  });

  test('the instant after Allow is not a verdict', () => {
    // Permission just granted, the device factory promise still unresolved,
    // and a timeout already banked against a camera that never existed yet.
    expect(walk({ lens: 'pending', previewTimedOut: true })).toBe('warming');
  });

  test('a scanner that cannot report frames never condemns a lens it found', () => {
    // The Android mechanism, which is what actually reached the reporter:
    // `CodeScanner` drops `onPreviewStarted`, so the wait could never end. The
    // component now treats the preview as started there, making this the input
    // it produces -- a found back lens, and no timeout to hold against it.
    expect(walk({ lens: 'back', previewTimedOut: false })).toBe('aiming');
    expect(pairingScanFault({ ...aiming, lens: 'back', previewTimedOut: false })).toBeNull();
  });

  test('a slow enumeration stays warming for as long as it takes', () => {
    expect(walk({ lens: 'pending' })).toBe('warming');
  });

  test('and the lens, when it lands, is simply the lens', () => {
    expect(walk({ lens: 'back' })).toBe('aiming');
    // Even carrying the stale timeout from before it resolved, which is the
    // state a real device arrives in.
    expect(walk({ lens: 'back', previewTimedOut: false })).toBe('aiming');
  });

  test('no step of the sequence ever says the device has no rear camera', () => {
    const sequence: Partial<ScanReadingInput>[] = [
      { hasPermission: false, lens: 'pending' },
      { hasPermission: false, lens: 'pending', previewTimedOut: true },
      { lens: 'pending', previewTimedOut: true },
      { lens: 'pending' },
      { lens: 'back' },
    ];
    for (const step of sequence) {
      expect(pairingScanFault({ ...aiming, ...step })).not.toBe('no-lens');
    }
  });

  test('and if that tablet really does enumerate nothing, it says so honestly', () => {
    // The hypothesis this fix cannot rule out from here: that vision-camera
    // enumerates no lens at all on that hardware, even though the system camera
    // app the attachment flow hands off to opens one fine. If so the reading is
    // still not a lie -- it is "no camera was found", with a diagnostic naming
    // what was enumerated, which is the round trip that settles it.
    expect(pairingScanFault({ ...aiming, lens: 'none' })).toBe('no-lens');
  });
});

describe('the emulators this screen was checked on', () => {
  test('a device with genuinely no camera still says so', () => {
    // The true negative. An Android emulator enumerates an empty list and never
    // fills it, so after the grace period this must still be a dead end -- the
    // fix must not turn "nothing here" into a spinner that never resolves.
    const lens = pairingLensReading({
      hasBackLens: false,
      hasFrontLens: false,
      lensCount: 0,
      settled: true,
    });
    expect(lens).toBe('none');
    expect(pairingScanReading({ ...aiming, lens })).toBe('unavailable');
    expect(pairingScanFault({ ...aiming, lens })).toBe('no-lens');
    expect(pairingScanPresentation('unavailable').promotesManualEntry).toBe(true);
  });

  test('an Android scanner that cannot report a first frame is not a fault', () => {
    // `CodeScanner` never forwards `onPreviewStarted`, so the component treats
    // the preview as started. The timeout must therefore be unreachable there.
    expect(pairingScanReading({ ...aiming, previewTimedOut: false })).toBe('aiming');
  });
});

describe('pairingScanFault', () => {
  test('explains only the state that has to explain itself', () => {
    for (const reading of [
      aiming,
      { ...aiming, lens: 'pending' as const },
      { ...aiming, hasPermission: false },
      { ...aiming, rejected: true },
      { ...aiming, busy: true },
      { ...aiming, detected: true },
    ]) {
      expect(pairingScanFault(reading)).toBeNull();
    }
  });

  test('names the cause rather than blaming the hardware for all four', () => {
    expect(pairingScanFault({ ...aiming, isWeb: true })).toBe('web');
    expect(pairingScanFault({ ...aiming, cameraError: true })).toBe('camera-error');
    expect(pairingScanFault({ ...aiming, lens: 'none' })).toBe('no-lens');
    expect(pairingScanFault({ ...aiming, previewTimedOut: true })).toBe(
      'preview-never-started'
    );
  });

  test('a camera error is reported as the error, not as a missing lens', () => {
    expect(pairingScanFault({ ...aiming, cameraError: true, lens: 'none' })).toBe('camera-error');
  });
});

describe('pairingScanReadingWithRequest', () => {
  const idle = { cameraError: false, detected: false, busy: false, rejected: false };

  test('passes the lens reading through when nothing is in flight', () => {
    for (const reading of ['aiming', 'aiming-front', 'warming', 'permission', 'unavailable'] as const) {
      expect(pairingScanReadingWithRequest(reading, idle)).toBe(reading);
    }
  });

  test('a request in flight outranks the lens, then a code in frame', () => {
    expect(pairingScanReadingWithRequest('unavailable', { ...idle, busy: true })).toBe('claiming');
    expect(pairingScanReadingWithRequest('aiming', { ...idle, detected: true })).toBe('found');
    expect(
      pairingScanReadingWithRequest('aiming', { ...idle, detected: true, busy: true })
    ).toBe('claiming');
  });

  test('a refused code only holds while there are pixels to hold', () => {
    expect(pairingScanReadingWithRequest('aiming', { ...idle, rejected: true })).toBe('rejected');
    expect(pairingScanReadingWithRequest('aiming-front', { ...idle, rejected: true })).toBe(
      'rejected'
    );
    // A lens that stopped being available mid-hold has nothing to re-read.
    expect(pairingScanReadingWithRequest('warming', { ...idle, rejected: true })).toBe('warming');
    expect(pairingScanReadingWithRequest('unavailable', { ...idle, rejected: true })).toBe(
      'unavailable'
    );
  });

  test('the route can call the camera broken on its own evidence', () => {
    expect(pairingScanReadingWithRequest('aiming', { ...idle, cameraError: true })).toBe(
      'unavailable'
    );
  });
});

describe('pairingScanPresentation', () => {
  test('only draws over camera pixels while there are camera pixels', () => {
    expect(pairingScanPresentation('aiming').showsPreview).toBe(true);
    expect(pairingScanPresentation('aiming-front').showsPreview).toBe(true);
    expect(pairingScanPresentation('found').showsPreview).toBe(true);
    expect(pairingScanPresentation('rejected').showsPreview).toBe(true);

    for (const reading of ['unavailable', 'permission', 'claiming', 'warming'] as const) {
      expect(pairingScanPresentation(reading).showsPreview).toBe(false);
      expect(pairingScanPresentation(reading).showsReticle).toBe(false);
    }
  });

  test('closes the reticle only on a code that was accepted', () => {
    expect(pairingScanPresentation('found').reticleClosed).toBe(true);
    expect(pairingScanPresentation('aiming').reticleClosed).toBe(false);
    expect(pairingScanPresentation('rejected').reticleClosed).toBe(false);
  });

  test('recommends the manual route exactly when scanning cannot work', () => {
    expect(pairingScanPresentation('unavailable').promotesManualEntry).toBe(true);
    expect(pairingScanPresentation('permission').promotesManualEntry).toBe(true);
    expect(pairingScanPresentation('aiming').promotesManualEntry).toBe(false);
    // A front lens is scanning, not a fallback to apologise for.
    expect(pairingScanPresentation('aiming-front').promotesManualEntry).toBe(false);
    // A lens that has not answered yet is not a lens that is missing.
    expect(pairingScanPresentation('warming').promotesManualEntry).toBe(false);
    // A refused code is a scan that can still succeed on the next try, and a
    // request in flight is already past the point of choosing a route.
    expect(pairingScanPresentation('rejected').promotesManualEntry).toBe(false);
    expect(pairingScanPresentation('claiming').promotesManualEntry).toBe(false);
  });

  test('waits on the gateway only while a request is in flight', () => {
    expect(pairingScanPresentation('claiming').isWaiting).toBe(true);
    expect(pairingScanPresentation('found').isWaiting).toBe(false);
  });
});

describe('pairingApertureSize', () => {
  test('is square and fills a phone column', () => {
    // 390pt window less the route's 20pt gutters.
    expect(pairingApertureSize(350)).toBe(350);
  });

  test('stops growing rather than becoming a wall on a tablet', () => {
    expect(pairingApertureSize(720)).toBe(APERTURE_MAX_SIZE);
    expect(pairingApertureSize(2048)).toBe(APERTURE_MAX_SIZE);
  });

  test('never returns a negative or non-finite size', () => {
    for (const width of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const size = pairingApertureSize(width);
      expect(Number.isFinite(size)).toBe(true);
      expect(size).toBeGreaterThanOrEqual(0);
    }
  });
});
