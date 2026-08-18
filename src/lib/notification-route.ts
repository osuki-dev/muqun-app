export type NotificationRoute = {
  pathname: '/servers/[serverId]';
  params: {
    serverId: string;
    sessionId?: string;
    paneId?: string;
    notificationId?: string;
  };
};

export function notificationRoute(
  data: Record<string, unknown> | undefined,
  notificationId?: string
): NotificationRoute | string | null {
  const serverId = stringField(data, 'server_id', 'serverId');
  if (serverId) {
    const sessionId = stringField(data, 'session_id', 'sessionId');
    const paneId = stringField(data, 'pane_id', 'paneId');
    return {
      pathname: '/servers/[serverId]',
      params: {
        serverId,
        ...(sessionId ? { sessionId } : {}),
        ...(paneId ? { paneId } : {}),
        ...(notificationId ? { notificationId } : {}),
      },
    };
  }

  const url = data?.url;
  return isInternalRoute(url) ? url : null;
}

function stringField(
  data: Record<string, unknown> | undefined,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function isInternalRoute(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('://');
}
