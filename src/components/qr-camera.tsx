import { StyleSheet } from 'react-native';
import { Camera, isScannedCode, useObjectOutput } from 'react-native-vision-camera';

import type { LensPosition } from '@/lib/pairing-scan';

/**
 * What this platform's scanner can actually do, so the aperture stops assuming.
 *
 * Both facts are true of vision-camera's own `Camera` and false of the Android
 * barcode-scanner component this file has a sibling for, and the aperture used
 * to wait on one of them everywhere -- which on Android meant waiting forever
 * for a callback that view never makes.
 */
export const qrCameraSupport = {
  /** `onPreviewStarted` fires here, so the shutter has something to lift on. */
  reportsFirstFrame: true,
  /** The lens position is ours to choose, so a front-only device still scans. */
  lensPositions: ['back', 'front'] as LensPosition[],
};

type QrCameraProps = {
  active: boolean;
  onError: (error: Error) => void;
  /**
   * The preview has received its first frame.
   *
   * Until it does, the native preview is a `SurfaceView` with nothing in it,
   * which composites as a black rectangle -- the flash the reader sees when
   * they come back from manual entry. The scanner keeps its own surface over
   * the camera until this fires.
   */
  onPreviewStarted: () => void;
  onScanned: (value: string) => void;
  position: LensPosition;
};

const qrObjectTypes = ['qr'] as const;

export function QrCamera({
  active,
  onError,
  onPreviewStarted,
  onScanned,
  position,
}: QrCameraProps) {
  const output = useObjectOutput({
    types: [...qrObjectTypes],
    onObjectsScanned(objects) {
      const code = objects.find(isScannedCode);
      if (code?.value) onScanned(code.value);
    },
  });

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      isActive={active}
      device={position}
      outputs={[output]}
      onPreviewStarted={onPreviewStarted}
      onError={onError}
    />
  );
}
