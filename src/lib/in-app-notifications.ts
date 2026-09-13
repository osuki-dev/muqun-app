import { notificationRoute, type NotificationRoute } from './notification-route';
import { sanitizeServerText } from './ssh-server-text';

export interface InAppNotice {
  id: string;
  title: string;
  body: string;
  route: NotificationRoute | string | null;
}

export interface NoticeQueue {
  items: InAppNotice[];
  seen: string[];
}

export const MAX_NOTICES = 20;
export const MAX_SEEN_NOTICES = 200;

/** Memory-only: never persist notification bodies or approval details. */
export function enqueueNotice(queue: NoticeQueue, notice: InAppNotice): NoticeQueue {
  if (
    !notice.id ||
    queue.seen.includes(notice.id) ||
    queue.items.some((item) => item.id === notice.id)
  )
    return queue;
  return {
    // Keep the visible item stable while new events arrive behind it.
    items:
      queue.items.length >= MAX_NOTICES
        ? [queue.items[0], ...queue.items.slice(2), notice]
        : [...queue.items, notice],
    seen: [...queue.seen, notice.id].slice(-MAX_SEEN_NOTICES),
  };
}

export function dismissNotice(queue: NoticeQueue, id: string): NoticeQueue {
  return { ...queue, items: queue.items.filter((item) => item.id !== id) };
}

export function noticeFromPush(
  id: string,
  content: { title?: unknown; body?: unknown; data?: Record<string, unknown> }
): InAppNotice | null {
  const title = sanitizeServerText(content.title, 120).replace(/\n/g, ' ');
  const body = sanitizeServerText(content.body, 320);
  if (!id || id.length > 512 || (!title && !body)) return null;
  return { id, title, body, route: notificationRoute(content.data, id) };
}

/** Foreground messages belong to the app, background delivery stays with the OS. */
export function noticePresentation(enabled: boolean, active: boolean) {
  return { inApp: enabled && active, system: enabled && !active };
}
