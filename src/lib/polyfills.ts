// Early runtime polyfills for headless and server environments.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = ((cb: (time: number) => void) =>
    setTimeout(() => cb(Date.now()), 16)) as unknown as typeof requestAnimationFrame;
}

if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
}
