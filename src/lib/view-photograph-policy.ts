/**
 * The explicit shared-buffer import refusal from react-native-webgpu's
 * NativeFrameImport.cpp, reached through GPUExternalTexture::Create.
 * Lifecycle, size, allocation and device-loss errors must not permanently
 * switch subsequent photographs to CPU readback.
 */
export function isViewPhotographImportFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith(
      "GPUDevice::importExternalTexture(): the import failed - is the 'shared-texture-memory-iosurface' "
    )
  );
}
