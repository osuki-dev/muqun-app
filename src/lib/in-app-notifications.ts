import { notificationRoute, type NotificationRoute } from './notification-route';
import { sanitizeServerText } from './ssh-server-text';

/**
 * What a notice is about, when the app has something to say about it itself.
 *
 * An approval is the one kind whose life the app knows: it stands while the
 * agent is waiting and means nothing the moment the request is answered --
 * from the card, from the lock screen, or by another device. Everything else
 * is `general` and lives until it is read or dismissed.
 */
export type NoticeKind = 'approval' | 'general';

export interface InAppNotice {
  id: string;
  title: string;
  body: string;
  route: NotificationRoute | string | null;
  kind: NoticeKind;
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

/** Every notice of one kind at once: an approval nobody is waiting on any more. */
export function dismissNoticeKind(queue: NoticeQueue, kind: NoticeKind): NoticeQueue {
  if (!queue.items.some((item) => item.kind === kind)) return queue;
  return { ...queue, items: queue.items.filter((item) => item.kind !== kind) };
}

/**
 * Whether a push is the gateway asking for an approval.
 *
 * Read for the opposite reason `pane-approval.ts` reads the same payload: not
 * to answer the question but to know when it has been answered elsewhere and
 * the notice can go. Four spellings because the gateway has sent all four --
 * a pane approval arrives with `categoryId`, an agent permission with
 * `category` and a bare `type: "approval"` -- and a notice that misses its own
 * kind simply never goes away on its own.
 */
function pushIsApproval(data: Record<string, unknown> | undefined): boolean {
  return (
    data?.categoryId === 'approval' ||
    data?.category === 'approval' ||
    data?.type === 'approval' ||
    data?.type === 'approval.pending'
  );
}

export function noticeFromPush(
  id: string,
  content: { title?: unknown; body?: unknown; data?: Record<string, unknown> }
): InAppNotice | null {
  const title = sanitizeServerText(content.title, 120).replace(/\n/g, ' ');
  const body = sanitizeServerText(content.body, 320);
  if (!id || id.length > 512 || (!title && !body)) return null;
  return {
    id,
    title,
    body,
    route: notificationRoute(content.data, id),
    kind: pushIsApproval(content.data) ? 'approval' : 'general',
  };
}

/** Foreground messages belong to the app, background delivery stays with the OS. */
export function noticePresentation(enabled: boolean, active: boolean) {
  return { inApp: enabled && active, system: enabled && !active };
}
