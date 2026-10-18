import { describe, expect, test } from 'bun:test';

import { isViewPhotographImportFailure } from '../view-photograph-policy';

describe('view photograph fallback', () => {
  test('remembers the native shared-buffer import refusal', () => {
    expect(
      isViewPhotographImportFailure(
        new Error(
          "GPUDevice::importExternalTexture(): the import failed - is the 'shared-texture-memory-iosurface' (Apple) or 'shared-texture-memory-ahardware-buffer' (Android) feature enabled on the device, and the handle a usable IOSurface / AHardwareBuffer?"
        )
      )
    ).toBe(true);
  });

  test.each([
    'drawElementImageToTexture: no native view found for tag 12 (is the view mounted, and rendered with collapsable={false}?)',
    'drawElementImageToTexture: the view has no size yet',
    'drawElementImageToTexture: the view produced no pixels (is it mounted with a non-zero size?)',
    'GPUDevice::importExternalTexture(): the frame has been released',
    'GPUDevice::importExternalTexture(): BeginAccess failed',
    'GPU device lost',
  ])('does not remember a transient capture failure: %s', (message) => {
    expect(isViewPhotographImportFailure(new Error(message))).toBe(false);
  });

  test('does not classify arbitrary rejection values as device capability', () => {
    expect(isViewPhotographImportFailure(null)).toBe(false);
    expect(isViewPhotographImportFailure({ message: 'import failed' })).toBe(false);
  });
});
