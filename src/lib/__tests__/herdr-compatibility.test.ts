/**
 * The gate between a health answer and the rest of the app. One promise is
 * being protected here: the gateway decides whether it can speak to the Herdr
 * it found, and this side only reports that decision. Re-deriving it from the
 * protocol number is what made a working Herdr unreachable, so the tests are
 * written against the verdict, not against any particular number.
 */
import { describe, expect, test } from 'bun:test';

import { assertSupportedHerdr, MINIMUM_HERDR_VERSION } from '../herdr-compatibility';

describe('a backend the gateway accepts', () => {
  test('passes on the protocol Muqun shipped against', () => {
    expect(() =>
      assertSupportedHerdr({
        herdr: {
          connected: true,
          version: '0.7.5',
          protocol: 17,
          compatible: true,
          supportedProtocolMin: 17,
          supportedProtocolMax: null,
        },
      })
    ).not.toThrow();
  });

  test('passes on a Herdr newer than the app has heard of', () => {
    // 0.8.0 moved the number to 19 for TUI reasons. The gateway says it can
    // still speak to it, so the app has nothing to add.
    expect(() =>
      assertSupportedHerdr({
        herdr: {
          connected: true,
          version: '0.8.0',
          protocol: 19,
          compatible: true,
          supportedProtocolMin: 17,
          supportedProtocolMax: null,
        },
      })
    ).not.toThrow();
  });

  test('passes on a protocol far outside anything known, if the gateway says so', () => {
    // The point of deferring: no release of the app has to be taught this
    // number for a gateway that already speaks it to be usable.
    expect(() =>
      assertSupportedHerdr({
        herdr: {
          connected: true,
          version: '9.9.9',
          protocol: 4242,
          compatible: true,
          supportedProtocolMin: 17,
          supportedProtocolMax: null,
        },
      })
    ).not.toThrow();
  });

  test('passes when the gateway is too old to send a verdict at all', () => {
    // Absent is not a refusal. It connected, which is the only thing a gateway
    // of that vintage says, and treating silence as failure would strand it.
    expect(() =>
      assertSupportedHerdr({
        herdr: { connected: true, version: '0.7.5', protocol: 17 },
      })
    ).not.toThrow();
  });
});

describe('a backend the gateway refuses', () => {
  test('names Herdr as the old one when it is below the floor', () => {
    expect(() =>
      assertSupportedHerdr({
        herdr: {
          connected: true,
          version: '0.6.0',
          protocol: 12,
          compatible: false,
          supportedProtocolMin: 17,
          supportedProtocolMax: null,
        },
      })
    ).toThrow(
      'Herdr 0.6.0 (protocol 12) is older than Muqun Gateway supports ' +
        '(protocol 17 or newer). Update Herdr and restart the session.'
    );
  });

  test('names the gateway as the old one when Herdr is above its ceiling', () => {
    // The bug this card exists for: the old message told the user to update
    // the Herdr they had just updated. The gateway is the side that is behind.
    expect(() =>
      assertSupportedHerdr({
        herdr: {
          connected: true,
          version: '0.8.0',
          protocol: 19,
          compatible: false,
          supportedProtocolMin: 17,
          supportedProtocolMax: 17,
        },
      })
    ).toThrow(
      'Herdr 0.8.0 (protocol 19) is newer than Muqun Gateway supports ' +
        '(up to protocol 17). Herdr is fine -- update Muqun Gateway on the ' +
        'server and restart it.'
    );
  });

  test('blames neither side when the refusal comes with no range', () => {
    expect(() =>
      assertSupportedHerdr({
        herdr: { connected: true, version: '0.8.0', protocol: 19, compatible: false },
      })
    ).toThrow(
      'Muqun Gateway reports it cannot speak to Herdr 0.8.0 (protocol 19). ' +
        'Update Muqun Gateway on the server and restart it.'
    );
  });

  test('still explains itself when the version is missing', () => {
    expect(() =>
      assertSupportedHerdr({
        herdr: { connected: true, compatible: false },
      })
    ).toThrow(
      'Muqun Gateway reports it cannot speak to the Herdr on this server. ' +
        'Update Muqun Gateway on the server and restart it.'
    );
  });
});

describe('a backend that is not there', () => {
  test('asks for Herdr to be started', () => {
    const expected = `Start Herdr ${MINIMUM_HERDR_VERSION} or newer, then try again.`;
    expect(() =>
      assertSupportedHerdr({
        herdr: { connected: false },
        backend: { kind: 'herdr' },
      })
    ).toThrow(expected);
  });

  test('names tmux when tmux is the backend that is down', () => {
    // The `herdr` key is a legacy envelope carrying the primary backend's
    // verdict whatever that backend is. Reading it as a statement about Herdr
    // is how a server whose tmux was unreachable told its owner to go and
    // start a program they were not running and did not need.
    expect(() =>
      assertSupportedHerdr({
        herdr: { connected: false },
        backend: { kind: 'tmux' },
      })
    ).toThrow(
      'Muqun Gateway cannot reach tmux on this server. Check that a tmux server is ' +
        'running and that the gateway can find the tmux program, then try again.'
    );
  });

  test('names a backend this build has never heard of', () => {
    expect(() =>
      assertSupportedHerdr({
        herdr: { connected: false },
        backend: { kind: 'screen' },
      })
    ).toThrow(
      'Muqun Gateway cannot reach the screen backend on this server. Start it, then try again.'
    );
  });

  test('still asks for Herdr when the gateway names no backend', () => {
    // A gateway old enough to omit `backend` predates tmux being one, so Herdr
    // is the only thing it can have meant.
    const expected = `Start Herdr ${MINIMUM_HERDR_VERSION} or newer, then try again.`;
    expect(() => assertSupportedHerdr({ herdr: { connected: false } })).toThrow(expected);
    expect(() => assertSupportedHerdr({})).toThrow(expected);
  });

  test('does not let a disconnected backend through on a compatible flag', () => {
    expect(() =>
      assertSupportedHerdr({
        herdr: { connected: false, compatible: true, protocol: 17 },
      })
    ).toThrow(`Start Herdr ${MINIMUM_HERDR_VERSION} or newer, then try again.`);
  });
});
