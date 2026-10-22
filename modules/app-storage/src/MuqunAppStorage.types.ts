/** What Android's Storage screen shows for this app, in bytes. */
export type AppStorageStats = {
  appBytes: number;
  /** User data, excluding the cache. */
  dataBytes: number;
  cacheBytes: number;
};

export type AppStorageModule = {
  readonly contractVersion: number;
  /** True for the first JavaScript context of this process, false afterwards. */
  claimProcessLaunch(): boolean;
  /** Null where the platform has no per-app figures (iOS) or refuses the query. */
  getStorageStats(): Promise<AppStorageStats | null>;
};
