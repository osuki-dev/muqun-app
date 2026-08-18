// The card an App Store reviewer scans (card #845).
//
// 1.3.0 was rejected because the pairing screen could not be assessed at all:
// the app declares a camera use for QR pairing, and the only way past that
// screen was a QR printed by a Gateway on a computer the reviewer does not
// have. These are the rules for the one payload that opens the bundled demo
// instead, and they are asserted here rather than inside the screen because the
// screen is where the answer is used, not where it is decided.
import { describe, expect, test } from 'bun:test';

import {
  DEMO_PAIRING_SERVER_ID,
  isDemoPairingOffer,
  parsePairingOffer,
} from '@/lib/pairing';

const DEMO_QR = `muqun://pair?u=https://demo.invalid&s=${DEMO_PAIRING_SERVER_ID}`;

describe('isDemoPairingOffer', () => {
  test('the QR we hand Apple parses, and is recognised', () => {
    // The whole contract in one assertion: the exact string encoded into the
    // demo QR handed to App Review survives the ordinary parser and then takes
    // the demo branch. If either half breaks, the reviewer scans it and gets
    // "This QR code is not valid." The image itself is not in this repository
    // -- it is regenerated from this string, which is why this test pins it.
    const offer = parsePairingOffer(DEMO_QR);
    expect(offer.serverId).toBe(DEMO_PAIRING_SERVER_ID);
    expect(isDemoPairingOffer(offer)).toBe(true);
  });

  test('the address it carries cannot resolve', () => {
    // Belt and braces on top of the branch returning before any request: the
    // host is under `.invalid`, which RFC 2606 reserves so that it can never be
    // registered or resolved. A payload that could name a real machine would be
    // one an attacker could aim.
    const offer = parsePairingOffer(DEMO_QR);
    expect(offer.url.endsWith('.invalid')).toBe(true);
  });

  test('an ordinary gateway QR is not the demo', () => {
    const offer = parsePairingOffer('muqun://pair?u=https://box.example:23847&s=real-server');
    expect(isDemoPairingOffer(offer)).toBe(false);
  });

  test('a server id that merely contains the demo id is not the demo', () => {
    // `muqun-demo-2` is a name a real gateway may legitimately have, and an
    // offer for it must pair rather than silently open sample data.
    expect(
      isDemoPairingOffer(parsePairingOffer('muqun://pair?u=https://box.example&s=muqun-demo-2'))
    ).toBe(false);
    expect(
      isDemoPairingOffer(parsePairingOffer('muqun://pair?u=https://box.example&s=not-muqun-demo'))
    ).toBe(false);
  });

  test('a manual offer, which carries no server id, is not the demo', () => {
    // Typing an address reaches `beginPairing` without a server id at all --
    // it is resolved later, from the gateway's own answer -- so an undefined id
    // must never read as a match.
    expect(isDemoPairingOffer({ url: 'https://box.example' })).toBe(false);
  });

  test('rubbish is still rubbish', () => {
    // The demo branch must not widen what the scanner accepts.
    expect(() => parsePairingOffer('https://example.com')).toThrow();
    expect(() => parsePairingOffer('muqun://pair?u=https://box.example')).toThrow();
    expect(() => parsePairingOffer('not a url at all')).toThrow();
  });
});
