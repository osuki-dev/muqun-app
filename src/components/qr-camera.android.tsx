import { StyleSheet } from 'react-native';
import { CodeScanner } from 'react-native-vision-camera-barcode-scanner';

import type { LensPosition } from '@/lib/pairing-scan';

/**
 * What this platform's scanner can actually do, so the aperture stops assuming.
 *
 * Both of these are `false`/back-only because `CodeScanner` owns the `Camera`
 * it renders and exposes almost none of it: it forwards `isActive`, `style` and
 * `onError` and nothing else. Reading its source is the only way to know that,
 * and not knowing it was the bug -- the aperture handed it an `onPreviewStarted`
 * that was silently dropped, then waited on a callback that could never arrive,
 * then blamed the hardware when the wait ran out. Every Android device with a
 * working rear camera got "this device has no rear camera" 2.5 seconds after
 * the preview mounted.
 *
 * Including the emulators this screen was signed off on. `dumpsys media.camera`
 * reports one back-facing device on both of them, so the "no rear camera" they
 * showed was never the true negative it was read as -- it was this. A fallback
 * that is also the expected output on every device the team owns is a fallback
 * nobody can tell is broken, which is the whole reason it survived to ship.
 */
export const qrCameraSupport = {
  /** `CodeScanner` does not forward `onPreviewStarted`, so nothing ever fires. */
  reportsFirstFrame: false,
  /**
   * `CodeScanner` hardcodes `useCameraDevice('back')` and throws outright if it
   * resolves to nothing, so the front lens is not reachable here and must never
   * be mounted -- the throw would land inside the route's Suspense boundary.
   */
  lensPositions: ['back'] as LensPosition[],
};

type QrCameraProps = {
  active: boolean;
  onError: (error: Error) => void;
  onPreviewStarted: () => void;
  onScanned: (value: string) => void;
  position: LensPosition;
};

const qrBarcodeFormats: 'qr-code'[] = ['qr-code'];

export function QrCamera({ active, onError, onScanned }: QrCameraProps) {
  return (
    <CodeScanner
      style={StyleSheet.absoluteFill}
      isActive={active}
      barcodeFormats={qrBarcodeFormats}
      onBarcodeScanned={(barcodes) => {
        const value = barcodes[0]?.rawValue;
        if (value) onScanned(value);
      }}
      onError={onError}
    />
  );
}
