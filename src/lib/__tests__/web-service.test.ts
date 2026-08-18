/**
 * The arithmetic behind opening a web service on the paired machine.
 *
 * Two promises are protected here. The gate only ever says yes to a connection
 * where opening a URL is honest -- and says no to everything it does not
 * recognise, including whatever a future gateway invents. And the URL a port
 * turns into is the one on screen: same machine, same scheme, that port, nothing
 * carried across from the gateway's own address.
 */
import { describe, expect, test } from 'bun:test';

import {
  allowsWebServiceOpen,
  describeWebServiceUrl,
  MAX_PORT,
  parsePort,
  webServiceUrl,
} from '../web-service';

describe('which connections may be offered this at all', () => {
  test('a tailnet connection can, because every port on that host is already reachable', () => {
    expect(allowsWebServiceOpen('tailscale-wireguard')).toBe(true);
  });

  test('a connection the operator put TLS in front of can', () => {
    expect(allowsWebServiceOpen('https')).toBe(true);
  });

  test('cleartext over an unvouched-for network cannot', () => {
    expect(allowsWebServiceOpen('unencrypted-http')).toBe(false);
  });

  test('a loopback-bound gateway cannot, because reaching it says nothing about other ports', () => {
    expect(allowsWebServiceOpen('local-only')).toBe(false);
  });

  test('a gateway admitting it cannot tell is not a yes', () => {
    expect(allowsWebServiceOpen('unknown')).toBe(false);
  });

  test('a gateway too old to report anything is not a yes', () => {
    expect(allowsWebServiceOpen(undefined)).toBe(false);
  });

  test('the gate fails closed on a value it does not recognise', () => {
    expect(allowsWebServiceOpen('wireguard')).toBe(false);
    expect(allowsWebServiceOpen('TAILSCALE-WIREGUARD')).toBe(false);
    expect(allowsWebServiceOpen('')).toBe(false);
  });
});

describe('reading a typed port', () => {
  test('keeps a plain port', () => {
    expect(parsePort('3000')).toBe(3000);
    expect(parsePort(' 8080 ')).toBe(8080);
  });

  test('accepts the ends of the range and refuses just past them', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(MAX_PORT);
    expect(parsePort('0')).toBeNull();
    expect(parsePort('65536')).toBeNull();
    expect(parsePort('70000')).toBeNull();
  });

  test('a leading zero is a typo with one meaning, not a different port', () => {
    expect(parsePort('03000')).toBe(3000);
  });

  test('refuses anything that is not only digits, rather than reading a prefix', () => {
    // `parseInt` would answer 3000 to the first two and 3 to the third, and a
    // field that opens a different port than the one on screen is worse than
    // one that refuses.
    expect(parsePort('3000x')).toBeNull();
    expect(parsePort('3000 3001')).toBeNull();
    expect(parsePort('3.5')).toBeNull();
    expect(parsePort('-1')).toBeNull();
    expect(parsePort('')).toBeNull();
    expect(parsePort('  ')).toBeNull();
  });
});

describe('building the URL to open', () => {
  test('keeps the host and swaps the gateway port for the typed one', () => {
    expect(webServiceUrl('http://osk.example.ts.net:23847', 3000)).toBe(
      'http://osk.example.ts.net:3000/'
    );
  });

  test('a gateway URL carrying no port still yields the typed one', () => {
    expect(webServiceUrl('https://desk.example.ts.net', 3000)).toBe(
      'https://desk.example.ts.net:3000/'
    );
  });

  test('an IPv6 literal keeps its brackets and does not keep the gateway port', () => {
    // `host` would have carried `:23847` across and produced a second colon-port
    // on an address that already ends in one.
    expect(webServiceUrl('http://[fd7a:115c:a1e0::1]:23847', 3000)).toBe(
      'http://[fd7a:115c:a1e0::1]:3000/'
    );
  });

  test('a raw tailnet IP works, it is just an address', () => {
    expect(webServiceUrl('http://100.64.0.2:23847', 8080)).toBe('http://100.64.0.2:8080/');
  });

  test('the scheme is carried over rather than assumed, so https is never downgraded', () => {
    expect(webServiceUrl('https://desk.example.ts.net:23847', 3000)).toBe(
      'https://desk.example.ts.net:3000/'
    );
  });

  test('the gateway own port is not special: it answers, which is a true answer', () => {
    expect(webServiceUrl('http://osk.example.ts.net:23847', 23847)).toBe(
      'http://osk.example.ts.net:23847/'
    );
  });

  test('nothing is carried across but scheme and host', () => {
    // The output goes to `Linking.openURL`; a builder that kept a path or
    // userinfo would be one stored-record change away from aiming the browser
    // somewhere nobody typed.
    expect(webServiceUrl('http://osk.ts.net:23847/api/v1?token=secret#frag', 3000)).toBe(
      'http://osk.ts.net:3000/'
    );
    expect(webServiceUrl('http://user:pass@osk.ts.net:23847', 3000)).toBe('http://osk.ts.net:3000/');
  });

  test('a missing gateway URL has nothing honest to open', () => {
    expect(webServiceUrl(undefined, 3000)).toBeNull();
    expect(webServiceUrl('', 3000)).toBeNull();
  });

  test('an unparseable or non-web gateway URL has nothing honest to open', () => {
    expect(webServiceUrl('not a url', 3000)).toBeNull();
    expect(webServiceUrl('ftp://osk.ts.net', 3000)).toBeNull();
    expect(webServiceUrl('muqun://pair?u=x', 3000)).toBeNull();
  });

  test('a port outside the range never becomes a URL', () => {
    expect(webServiceUrl('http://osk.ts.net:23847', 0)).toBeNull();
    expect(webServiceUrl('http://osk.ts.net:23847', 65536)).toBeNull();
    expect(webServiceUrl('http://osk.ts.net:23847', -1)).toBeNull();
    expect(webServiceUrl('http://osk.ts.net:23847', 3000.5)).toBeNull();
    expect(webServiceUrl('http://osk.ts.net:23847', Number.NaN)).toBeNull();
  });
});

describe('naming the URL on screen', () => {
  test('drops the scheme, because the machine and the port are what is being checked', () => {
    expect(describeWebServiceUrl('http://osk.example.ts.net:3000/')).toBe(
      'osk.example.ts.net:3000'
    );
  });

  test('keeps an IPv6 literal readable', () => {
    expect(describeWebServiceUrl('http://[fd7a:115c:a1e0::1]:3000/')).toBe(
      '[fd7a:115c:a1e0::1]:3000'
    );
  });

  test('hands back anything it cannot parse, so no caller has to guard a label', () => {
    expect(describeWebServiceUrl('nonsense')).toBe('nonsense');
  });
});
