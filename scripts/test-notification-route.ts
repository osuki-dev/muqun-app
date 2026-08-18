import { notificationRoute } from '../src/lib/notification-route';

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, received ${actualJson}`);
  }
}

equal(
  notificationRoute(
    {
      server_id: 'server-1',
      session_id: 'default',
      pane_id: 'w1:p2',
      url: '/servers/server-1',
    },
    'notification-1'
  ),
  {
    pathname: '/servers/[serverId]',
    params: {
      serverId: 'server-1',
      sessionId: 'default',
      paneId: 'w1:p2',
      notificationId: 'notification-1',
    },
  },
  'agent notification route'
);

equal(
  notificationRoute({ serverId: 'server-2', paneId: 'w2:p4' }),
  {
    pathname: '/servers/[serverId]',
    params: { serverId: 'server-2', paneId: 'w2:p4' },
  },
  'camel case compatibility'
);
equal(notificationRoute({ url: '/settings' }), '/settings', 'safe URL fallback');
equal(notificationRoute({ url: 'https://example.com' }), null, 'external URL rejection');
equal(notificationRoute({ url: '//example.com' }), null, 'protocol-relative URL rejection');

console.log('notification routing: all checks passed');
