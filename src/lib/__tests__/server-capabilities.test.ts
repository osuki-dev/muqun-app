/**
 * The mirror that lets the home screen gate an entry on a capability it cannot
 * ask for. Everything here protects one promise: a name in this list is a name
 * a reader may safely trust an `includes(...)` against.
 */
import { describe, expect, test } from 'bun:test';

import {
  MAX_MIRRORED_CAPABILITY_SERVERS,
  normalizeCapabilities,
  parseServerCapabilitiesIndex,
  sameCapabilities,
  withMirroredCapabilities,
  envelopeCapabilityNames,
  hasObservedCapability,
} from '../server-capabilities';

describe('reading a health answer', () => {
  test('keeps every name of a long list', () => {
    const names = Array.from({ length: 60 }, (_, i) => `cap_${i}`);
    expect(normalizeCapabilities(names)).toEqual(names);
  });

  test('bounds a hostile list at 512, keeping the first in order', () => {
    const names = Array.from({ length: 600 }, (_, i) => `cap_${i}`);
    expect(normalizeCapabilities(names)).toEqual(names.slice(0, 512));
  });

  test('keeps the names, in order, once each', () => {
    expect(normalizeCapabilities(['agent_spawn', ' assets ', 'assets'])).toEqual([
      'agent_spawn',
      'assets',
    ]);
  });

  test('a gateway too old to declare anything mirrors as nothing', () => {
    expect(normalizeCapabilities(undefined)).toEqual([]);
    expect(normalizeCapabilities(null)).toEqual([]);
    expect(normalizeCapabilities('agent_spawn')).toEqual([]);
  });

  test('drops entries that are not names', () => {
    // A falsy or non-string entry would survive `includes` questions as junk.
    expect(normalizeCapabilities(['agent_spawn', '', 7, null, { name: 'x' }])).toEqual([
      'agent_spawn',
    ]);
  });
});

describe('deciding whether to write', () => {
  test('an unchanged list is not worth a keychain write', () => {
    expect(sameCapabilities(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  test('a gained, lost or reordered capability is', () => {
    expect(sameCapabilities(['a'], ['a', 'b'])).toBe(false);
    expect(sameCapabilities(['a', 'b'], ['a'])).toBe(false);
    expect(sameCapabilities(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameCapabilities(undefined, [])).toBe(false);
  });
});

describe('writing one server in', () => {
  test('keeps the others', () => {
    expect(withMirroredCapabilities({ a: ['x'] }, 'b', ['y'])).toEqual({ a: ['x'], b: ['y'] });
  });

  test('replaces its own previous answer rather than merging with it', () => {
    // A gateway that lost a capability on an upgrade must not keep it here.
    expect(withMirroredCapabilities({ a: ['x', 'y'] }, 'a', ['x'])).toEqual({ a: ['x'] });
  });

  test('caps a long-lived install, evicting what has gone quiet longest', () => {
    let index = {};
    for (let i = 0; i < MAX_MIRRORED_CAPABILITY_SERVERS + 3; i += 1) {
      index = withMirroredCapabilities(index, `s${i}`, ['agent_spawn']);
    }
    const keys = Object.keys(index);
    expect(keys).toHaveLength(MAX_MIRRORED_CAPABILITY_SERVERS);
    expect(keys).not.toContain('s0');
    expect(keys).toContain(`s${MAX_MIRRORED_CAPABILITY_SERVERS + 2}`);
  });

  test('answering again moves a server to the young end', () => {
    let index = {};
    for (let i = 0; i < MAX_MIRRORED_CAPABILITY_SERVERS; i += 1) {
      index = withMirroredCapabilities(index, `s${i}`, ['agent_spawn']);
    }
    index = withMirroredCapabilities(index, 's0', ['agent_spawn', 'assets']);
    index = withMirroredCapabilities(index, 'fresh', ['agent_spawn']);
    // `s0` was written most recently of the old set, so `s1` is what goes.
    expect(Object.keys(index)).toContain('s0');
    expect(Object.keys(index)).not.toContain('s1');
  });
});

describe('reading the mirror back', () => {
  test('round-trips', () => {
    const index = { 'srv-1': ['agent_spawn', 'assets'] };
    expect(parseServerCapabilitiesIndex(JSON.stringify(index))).toEqual(index);
  });

  test('a server whose list survived as nothing is not kept as an empty answer', () => {
    expect(parseServerCapabilitiesIndex(JSON.stringify({ 'srv-1': [], 'srv-2': ['a'] }))).toEqual({
      'srv-2': ['a'],
    });
  });

  test('corrupt storage is an empty mirror, not a crash on launch', () => {
    expect(parseServerCapabilitiesIndex('not json')).toEqual({});
    expect(parseServerCapabilitiesIndex('[1,2]')).toEqual({});
  });
});

describe('what a content envelope advertises', () => {
  test('a name is on when its value is true or names a strategy', () => {
    expect(
      envelopeCapabilityNames({
        parts: true,
        assets: 'dictionary',
        session_descendants: true,
        composer: false,
        image_upload: 'none',
        pane_context: '',
        odd: 1,
      })
    ).toEqual(['parts', 'assets', 'session_descendants']);
  });

  test('anything but an object advertises nothing', () => {
    expect(envelopeCapabilityNames(undefined)).toEqual([]);
    expect(envelopeCapabilityNames(['session_descendants'])).toEqual([]);
    expect(envelopeCapabilityNames('session_descendants')).toEqual([]);
  });

  test('an observed name is asked about per server', () => {
    const observed = { osk: ['parts', 'session_descendants'] };
    expect(hasObservedCapability(observed, 'osk', 'session_descendants')).toBe(true);
    expect(hasObservedCapability(observed, 'mini', 'session_descendants')).toBe(false);
    expect(hasObservedCapability(observed, null, 'session_descendants')).toBe(false);
  });
});
