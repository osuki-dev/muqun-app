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
  simfarmDeviceKind,
  simfarmDevicesUrl,
  simfarmHealthUrl,
  simfarmClientUrl,
  simfarmThemedClientUrl,
  SIMFARM_DEFAULT_PORT,
} from '@/lib/simfarm';

const GATEWAY = 'https://mac-mini.example.ts.net:23847';

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
      'https://mac-mini.example.ts.net:8801/'
    );
  });

  test('keep an IPv6 literal in its brackets and drop the gateway port', () => {
    // The failure this guards is `[::1]:23847:8801`, which is not an address.
    expect(simfarmClientUrl('http://[::1]:23847', 8801)).toBe('http://[::1]:8801/');
  });

  test('the device list asks only for what is running', () => {
    expect(simfarmDevicesUrl(GATEWAY, 8801)).toBe(
      'https://mac-mini.example.ts.net:8801/devices?booted=1'
    );
  });

  test('health is its own path', () => {
    expect(simfarmHealthUrl(GATEWAY, 8801)).toBe('https://mac-mini.example.ts.net:8801/healthz');
  });

  test('no gateway, or a port that is not one, is no URL at all', () => {
    expect(simfarmClientUrl(undefined, 8801)).toBeNull();
    expect(simfarmDevicesUrl(undefined, 8801)).toBeNull();
    expect(simfarmClientUrl(GATEWAY, 0)).toBeNull();
    expect(simfarmClientUrl(GATEWAY, 70000)).toBeNull();
    expect(simfarmClientUrl('not a url', 8801)).toBeNull();
  });
});

describe('simfarmDeviceKind', () => {
  test('reads the provider off the id', () => {
    expect(simfarmDeviceKind('ios:00000000-0000-4000-8000-000000000000')).toBe('ios');
    expect(simfarmDeviceKind('android:emulator-5554')).toBe('android');
    expect(simfarmDeviceKind('wechat:wx0000000000000000')).toBe('wechat');
    expect(simfarmDeviceKind('mock:phone')).toBe('mock');
  });

  test('a provider added after this build is a device we cannot label, not a lost one', () => {
    expect(simfarmDeviceKind('harmony:whatever')).toBe('other');
    expect(simfarmDeviceKind('nocolon')).toBe('other');
  });
});

describe('parseSimfarmDevices', () => {
  test('reads the shape the server actually sends', () => {
    // The shape of a live `/devices?booted=1`, with invented ids. Deliberately
    // not the real answer from a development machine: a fixture pasted from a
    // running server carries that machine's identifiers into a public
    // repository, which is how a WeChat app id and a simulator UDID were
    // committed here once already.
    const body = {
      devices: [
        { id: 'mock:phone', name: 'Mock Phone', state: 'booted' },
        { id: 'ios:00000000-0000-4000-8000-000000000000', name: 'iPhone 17 Pro (iOS 26.5)' },
        { id: 'wechat:wx0000000000000000', name: 'Example mini program (WeChat)' },
      ],
    };
    expect(parseSimfarmDevices(body)).toEqual([
      { id: 'mock:phone', name: 'Mock Phone', kind: 'mock' },
      {
        id: 'ios:00000000-0000-4000-8000-000000000000',
        name: 'iPhone 17 Pro (iOS 26.5)',
        kind: 'ios',
      },
      { id: 'wechat:wx0000000000000000', name: 'Example mini program (WeChat)', kind: 'wechat' },
    ]);
  });

  test('an entry with no name is still a device, under its id', () => {
    expect(parseSimfarmDevices({ devices: [{ id: 'ios:abc' }] })).toEqual([
      { id: 'ios:abc', name: 'ios:abc', kind: 'ios' },
    ]);
  });

  test('drops what it cannot use and keeps the rest', () => {
    const body = {
      devices: [{ id: '' }, null, 'a string', { name: 'no id' }, { id: 'mock:pad', name: 'Pad' }],
    };
    expect(parseSimfarmDevices(body)).toEqual([{ id: 'mock:pad', name: 'Pad', kind: 'mock' }]);
  });

  test('a body that is not the envelope is an empty list, never a throw', () => {
    for (const body of [null, undefined, 42, 'text', {}, { devices: null }, { devices: {} }, []]) {
      expect(parseSimfarmDevices(body)).toEqual([]);
    }
  });
});

describe('simfarmThemedClientUrl', () => {
  const COLORS = {
    background: '#0B0F14',
    surface: '#141A21',
    text: '#E6EDF3',
    textMuted: '#8B98A5',
    border: '#232B33',
    primary: '#FF6B53',
    success: '#3FB950',
    warning: '#D29922',
    danger: '#F85149',
  };

  test('hands simfarm a palette it can read before its first paint', () => {
    const url = simfarmThemedClientUrl(GATEWAY, 8801, COLORS);
    expect(url).not.toBeNull();
    const param = new URL(url!).searchParams.get('theme');
    expect(param).not.toBeNull();

    // base64url: no padding, and none of the two characters standard base64
    // would have used. A `+` here becomes a space when the URL is parsed, which
    // is exactly the corruption this encoding exists to avoid.
    expect(param).not.toContain('=');
    expect(param).not.toContain('+');
    expect(param).not.toContain('/');

    // Round trip, through simfarm's own decoding steps.
    const b64 = param!.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(
      Buffer.from(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='), 'base64').toString('utf8')
    );
    expect(decoded).toEqual({
      bg: '#0B0F14',
      bgAlt: '#141A21',
      fg: '#E6EDF3',
      fgDim: '#8B98A5',
      line: '#232B33',
      accent: '#FF6B53',
      ok: '#3FB950',
      warn: '#D29922',
      bad: '#F85149',
    });
  });

  test('every key it sends is one simfarm actually applies', () => {
    // simfarm drops unknown keys silently, so a rename upstream would show up
    // as a panel that quietly stopped following the app rather than an error.
    const THEME_KEYS = ['bg', 'bgAlt', 'fg', 'fgDim', 'line', 'accent', 'ok', 'warn', 'bad'];
    const param = new URL(simfarmThemedClientUrl(GATEWAY, 8801, COLORS)!).searchParams.get(
      'theme'
    )!;
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(
      Buffer.from(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='), 'base64').toString('utf8')
    );
    expect(Object.keys(decoded).sort()).toEqual([...THEME_KEYS].sort());
  });

  test('no gateway is still no URL', () => {
    expect(simfarmThemedClientUrl(undefined, 8801, COLORS)).toBeNull();
  });
});
