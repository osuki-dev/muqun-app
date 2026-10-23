import { fromByteArray, toByteArray } from 'react-native-quick-base64';

/**
 * Base64url, natively.
 *
 * Every sealed gateway answer is base64 twice over -- the ciphertext in the
 * envelope, then the body inside the opened payload -- and both used to go
 * through the `buffer` polyfill's JavaScript decoder, with a third pass to
 * re-encode the whole ciphertext for the canonical-form check. On a 1.8 MB
 * transcript that was ~140 ms of the JS thread per read, on the frames the
 * screen was trying to paint. `react-native-quick-base64` decodes with simdutf
 * in native code, accepts both alphabets and unpadded input, and was already
 * linked for other callers.
 */
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Decodes standard or url-safe base64, padded or not. */
export function decodeBase64Url(value: string): Uint8Array {
  return toByteArray(value);
}

/** Url-safe, unpadded: the gateway's own spelling. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return fromByteArray(bytes, true);
}

/**
 * Whether `value` is the one spelling of the bytes it decodes to: the url-safe
 * alphabet, no padding, and no stray bits in the final quantum. Only the last
 * quantum can be non-canonical -- a full one round-trips exactly -- so the
 * check re-encodes at most two bytes instead of the whole payload.
 */
export function isCanonicalBase64Url(value: string, decoded: Uint8Array): boolean {
  if (!BASE64URL.test(value) || value.length % 4 === 1) return false;
  const tail = decoded.length % 3;
  if (tail === 0) return value.length === (decoded.length / 3) * 4;
  const chars = tail === 1 ? 2 : 3;
  return (
    value.length === Math.floor(decoded.length / 3) * 4 + chars &&
    encodeBase64Url(decoded.subarray(decoded.length - tail)) === value.slice(-chars)
  );
}
