/** Persistent asset identities must not include an iOS installation's container UUID. */
export function createThemeAssetPaths(directory: string | null) {
  const prefix = directory ? directory.replace(/\/$/, '') + '/' : null;
  const relative = /^theme-assets-v1\/([a-f0-9]{64}\.(?:png|jpeg|webp))$/;
  const filename = /^[a-f0-9]{64}\.(?:png|jpeg|webp)$/;
  // Only migrate the former iOS Documents location, never arbitrary external URLs.
  const legacy =
    /^file:\/\/\/(?:(?:private\/)?var\/mobile|(?:[^/]+\/)*CoreSimulator\/Devices\/[^/]+\/data)\/Containers\/Data\/Application\/[^/]+\/Documents\/theme-assets-v1\/([a-f0-9]{64}\.(?:png|jpeg|webp))$/;
  return {
    encode(uri: string): string {
      if (!prefix || !uri.startsWith(prefix)) return uri;
      const name = uri.slice(prefix.length);
      return filename.test(name) ? `theme-assets-v1/${name}` : uri;
    },
    decode(uri: string): string {
      if (!prefix) return uri;
      const name = relative.exec(uri)?.[1] ?? legacy.exec(uri)?.[1];
      return name ? prefix + name : uri;
    },
  };
}
