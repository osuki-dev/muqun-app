export type ThemeTransportResponse = {
  status: number;
  location?: string;
  contentType?: string;
  bytes: Uint8Array;
};

export type ThemeTransportModule = {
  readonly contractVersion: number;
  get(requestId: string, url: string, maxBytes: number): Promise<ThemeTransportResponse>;
  cancel(requestId: string): void;
};
