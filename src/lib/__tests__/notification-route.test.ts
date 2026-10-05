import { describe, expect, test } from 'bun:test';

import { notificationRoute, type NotificationRoute } from '../notification-route';

const approval = {
  type: 'approval',
  category: 'approval',
  approval_id: 'ap-1',
  server_id: 'server-1',
  asid: 'asid-1',
  agent_id: 'codex',
};

const question = {
  type: 'question',
  category: 'question',
  form_id: 'form-1',
  fingerprint: 'fp-1',
  server_id: 'server-1',
  asid: 'asid-1',
  agent_id: 'codex',
};

describe('agent session pushes open that session', () => {
  for (const [label, payload] of [
    ['approval', approval],
    ['question', question],
  ] as const) {
    test(`${label} on a Pad opens the workspace with the agent named`, () => {
      expect(notificationRoute(payload, 'n-1', { isPad: true })).toEqual({
        pathname: '/servers/[serverId]',
        params: { serverId: 'server-1', asid: 'asid-1', agentId: 'codex' },
      });
    });

    test(`${label} on a phone opens /agent`, () => {
      expect(notificationRoute(payload, 'n-1', { isPad: false })).toEqual({
        pathname: '/agent',
        params: { server: 'server-1', asid: 'asid-1', agentId: 'codex' },
      });
    });
  }

  test('defaults to the phone route and carries a gateway session id', () => {
    expect(
      notificationRoute({ serverId: 'server-1', asid: 'asid-1', session_id: 'herdr' })
    ).toEqual({
      pathname: '/agent',
      params: { server: 'server-1', sessionId: 'herdr', asid: 'asid-1' },
    });
  });

  test('an asid without a server falls back to the url', () => {
    expect(notificationRoute({ asid: 'asid-1', url: '/settings' }, 'n-1', { isPad: true })).toBe(
      '/settings'
    );
  });
});

describe('legacy and unknown pushes', () => {
  test('a terminal pane push is unchanged', () => {
    const payload = {
      categoryId: 'approval',
      server_id: 'server-1',
      session_id: 'default',
      pane_id: 'w1:p2',
      url: '/servers/server-1',
    };
    const expected: NotificationRoute = {
      pathname: '/servers/[serverId]',
      params: {
        serverId: 'server-1',
        sessionId: 'default',
        paneId: 'w1:p2',
        notificationId: 'n-1',
      },
    };
    expect(notificationRoute(payload, 'n-1', { isPad: true })).toEqual(expected);
    expect(notificationRoute(payload, 'n-1', { isPad: false })).toEqual(expected);
  });

  test('a safe url is followed and an external one rejected', () => {
    expect(notificationRoute({ url: '/settings' })).toBe('/settings');
    expect(notificationRoute({ url: 'https://example.com' })).toBeNull();
    expect(notificationRoute({ url: '//example.com' })).toBeNull();
  });

  test('an unknown payload has no destination, leaving the app on Home', () => {
    expect(notificationRoute({ type: 'mystery' }, 'n-1', { isPad: true })).toBeNull();
    expect(notificationRoute(undefined)).toBeNull();
  });
});
