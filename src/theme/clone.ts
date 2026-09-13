/**
 * Theme manifests and library snapshots contain validated JSON data only.
 * Avoid structuredClone: this layer also runs on native JS engines that do not
 * expose that browser API. This is not a clone helper for dates or native refs.
 */
export function cloneThemeData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
