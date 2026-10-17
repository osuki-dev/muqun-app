// Watching a simulator on the paired machine (card #851).
//
// Two things are worth pinning here and the rest follows from them.
//
// The first is the gate. simfarm v1 has no authentication and no Origin check --
// it defends itself by listening only on Tailscale and loopback -- so the app
// offering to open it across an unvouched network would be the app suggesting
// the reader expose a remote-control surface for their work machine. The gate
// has to fail closed on everything it does not recognise, including a value from
// a future gateway.
//
// The second is that the device list comes from a project on someone else's
// release cadence. A malformed answer must produce a shorter list, never an
// exception into a render.
import { describe, expect, test } from 'bun:test';

import {
  allowsSimfarmPreview,
  parseSimfarmDevices,
  simfarmDevicesUrl,
  simfarmHealthUrl,
  simfarmClientUrl,
  simfarmSocketUrl,
  SIMFARM_DEFAULT_PORT,
} from '@/lib/simfarm';

const GATEWAY = 'https://tower.example.ts.net:23847';

describe('allowsSimfarmPreview', () => {
  test('yes on the two connections that vouch for the network', () => {
    expect(allowsSimfarmPreview('tailscale-wireguard')).toBe(true);
    expect(allowsSimfarmPreview('https')).toBe(true);
  });

  test('no on everything else, including what it has never heard of', () => {
    for (const protection of [
      'unencrypted-http',
      'local-only',
      'unknown',
      'something-from-a-later-gateway',
      '',
      undefined,
    ]) {
      expect(allowsSimfarmPreview(protection)).toBe(false);
    }
  });
});

describe('the URLs', () => {
  test('take the gateway host and put the simfarm port on it', () => {
    expect(simfarmClientUrl(GATEWAY, SIMFARM_DEFAULT_PORT)).toBe(
      'https://tower.example.ts.net:8801/'
    );
  });

  test('keep an IPv6 literal in its brackets and drop the gateway port', () => {
    // The failure this guards is `[::1]:23847:8801`, which is not an address.
    expect(simfarmClientUrl('http://[::1]:23847', 8801)).toBe('http://[::1]:8801/');
  });

  test('the device list asks only for what is running', () => {
    expect(simfarmDevicesUrl(GATEWAY, 8801)).toBe(
      'https://tower.example.ts.net:8801/devices?booted=1'
    );
  });

  test('health is its own path', () => {
    expect(simfarmHealthUrl(GATEWAY, 8801)).toBe('https://tower.example.ts.net:8801/healthz');
  });

  test('no gateway, or a port that is not one, is no URL at all', () => {
    expect(simfarmClientUrl(undefined, 8801)).toBeNull();
    expect(simfarmDevicesUrl(undefined, 8801)).toBeNull();
    expect(simfarmClientUrl(GATEWAY, 0)).toBeNull();
    expect(simfarmClientUrl(GATEWAY, 70000)).toBeNull();
    expect(simfarmClientUrl('not a url', 8801)).toBeNull();
  });
});

const EMPTY_CAPABILITIES = { video: [], text: false, buttons: [], boot: false };

describe('parseSimfarmDevices', () => {
  test('reads the shape the server actually sends', () => {
    // The shape of a live `/devices?booted=1`, with invented ids. Deliberately
    // not the real answer from a development machine: a fixture pasted from a
    // running server carries that machine's identifiers into a public
    // repository, which is how a WeChat app id and a simulator UDID were
    // committed here once already.
    const body = {
      devices: [
        {
          id: 'mock:phone',
          name: 'Mock Phone',
          state: 'booted',
          screen: { width: 750, height: 1334, scale: 2 },
          capabilities: { video: ['jpeg'], text: true, buttons: ['home', 'lock'] },
        },
        {
          id: 'ios:00000000-0000-4000-8000-000000000000',
          name: 'iPhone 17 Pro (iOS 26.5)',
          state: 'shutdown',
          capabilities: { boot: true },
        },
        { id: 'wechat:wx0000000000000000', name: 'Example mini program (WeChat)' },
      ],
    };
    expect(parseSimfarmDevices(body)).toEqual([
      {
        id: 'mock:phone',
        name: 'Mock Phone',
        kind: 'mock',
        booted: true,
        screen: { width: 750, height: 1334, scale: 2 },
        capabilities: { video: ['jpeg'], text: true, buttons: ['home', 'lock'], boot: false },
      },
      {
        id: 'ios:00000000-0000-4000-8000-000000000000',
        name: 'iPhone 17 Pro (iOS 26.5)',
        kind: 'ios',
        booted: false,
        screen: undefined,
        // A device that is shut down still says whether it can be started,
        // and that is the one capability the picker reads before it is booted.
        capabilities: { ...EMPTY_CAPABILITIES, boot: true },
      },
      {
        id: 'wechat:wx0000000000000000',
        name: 'Example mini program (WeChat)',
        kind: 'wechat',
        booted: false,
        screen: undefined,
        capabilities: EMPTY_CAPABILITIES,
      },
    ]);
  });

  test('an entry with no name is still a device, under its id', () => {
    expect(parseSimfarmDevices({ devices: [{ id: 'ios:abc' }] })).toEqual([
      {
        id: 'ios:abc',
        name: 'ios:abc',
        kind: 'ios',
        booted: false,
        screen: undefined,
        capabilities: EMPTY_CAPABILITIES,
      },
    ]);
  });

  test('drops what it cannot use and keeps the rest', () => {
    const body = {
      devices: [{ id: '' }, null, 'a string', { name: 'no id' }, { id: 'mock:pad', name: 'Pad' }],
    };
    expect(parseSimfarmDevices(body)).toEqual([
      {
        id: 'mock:pad',
        name: 'Pad',
        kind: 'mock',
        booted: false,
        screen: undefined,
        capabilities: EMPTY_CAPABILITIES,
      },
    ]);
  });

  test('a body that is not the envelope is an empty list, never a throw', () => {
    for (const body of [null, undefined, 42, 'text', {}, { devices: null }, { devices: {} }, []]) {
      expect(parseSimfarmDevices(body)).toEqual([]);
    }
  });
});

describe('simfarmSocketUrl', () => {
  test('is the client URL with the scheme and the path the protocol names', () => {
    expect(simfarmSocketUrl('http://tower.example.ts.net:23847', 8801)).toBe(
      'ws://tower.example.ts.net:8801/v1'
    );
  });

  test('keeps a protected gateway protected', () => {
    // The one that would be silent: a `wss` downgraded to `ws` still connects,
    // still streams, and hands an unauthenticated remote-control channel to
    // anything on the path. `webServiceUrl` refuses to invent a downgrade for
    // the browser and this must not invent one either.
    expect(simfarmSocketUrl(GATEWAY, 8801)).toBe('wss://tower.example.ts.net:8801/v1');
  });

  test('carries an IPv6 literal in its brackets, and no gateway means no socket', () => {
    expect(simfarmSocketUrl('http://[::1]:23847', 8801)).toBe('ws://[::1]:8801/v1');
    expect(simfarmSocketUrl(undefined, 8801)).toBeNull();
    expect(simfarmSocketUrl(GATEWAY, 70000)).toBeNull();
  });
});

// The line the preview's empty state prints when there is no simfarm to find.
// It is a command rather than a link on purpose -- there is no install URL to
// print, and `links.ts` records what a URL that does not answer has already
// cost this app in review -- so the thing worth pinning is that it stays a
// command, and that it stays the *useful* one.
