export type AppStorageModule = {
  readonly contractVersion: number;
  /** True for the first JavaScript context of this process, false afterwards. */
  claimProcessLaunch(): boolean;
};
