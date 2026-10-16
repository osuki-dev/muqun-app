// The pairing screen's "pair again" entry takes an address only from a record
// this device holds, never from the route: the `muqun://` scheme is open to
// every app and page, and a prefilled attacker address would collect a code.
import { describe, expect, test } from 'bun:test';

import { pairAgainAddress } from '../pair-again-target';

const RECORDS = [
  { serverId: 'osk', url: 'http://10.0.2.2:23847' },
  { serverId: 'mini', url: 'http://mini.tail:23847', sshTunnel: { hostId: 'h' } },
];

describe('pairAgainAddress', () => {
  test('a held record is found by its id', () => {
    expect(pairAgainAddress({ serverId: 'osk' }, RECORDS)).toBe('http://10.0.2.2:23847');
  });

  test('a url parameter is ignored, with or without a serverId', () => {
    expect(pairAgainAddress({ url: 'http://attacker:23847' }, RECORDS)).toBe('');
    expect(pairAgainAddress({ serverId: 'osk', url: 'http://attacker:23847' }, RECORDS)).toBe(
      'http://10.0.2.2:23847'
    );
  });

  test('a serverId this device holds no record for is ignored', () => {
    expect(pairAgainAddress({ serverId: 'stranger' }, RECORDS)).toBe('');
    expect(pairAgainAddress({ serverId: '' }, RECORDS)).toBe('');
    expect(pairAgainAddress({ serverId: ['osk'] }, RECORDS)).toBe('');
    expect(pairAgainAddress({}, RECORDS)).toBe('');
  });

  test('a tunnelled record has no address the screen can dial', () => {
    expect(pairAgainAddress({ serverId: 'mini' }, RECORDS)).toBe('');
  });
});
