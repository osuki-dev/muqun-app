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

function destinationKey(route: InAppNotice['route']): string {
  if (!route) return 'none';
  if (typeof route === 'string') return `path:${route}`;
  return JSON.stringify([
    route.pathname,
    route.params.serverId,
    route.params.sessionId ?? '',
    route.params.paneId ?? '',
  ]);
}

/** Approvals are distinct requests; ordinary matching updates share one card. */
function semanticNoticeKey(notice: InAppNotice): string | null {
  if (notice.kind === 'approval') return null;
  return JSON.stringify([notice.kind, notice.title, notice.body, destinationKey(notice.route)]);
}

/** Memory-only: never persist notification bodies or approval details. */
export function enqueueNotice(queue: NoticeQueue, notice: InAppNotice): NoticeQueue {
  if (
    !notice.id ||
    queue.seen.includes(notice.id) ||
    queue.items.some((item) => item.id === notice.id)
  )
    return queue;
  const semanticKey = semanticNoticeKey(notice);
  if (semanticKey) {
    let replaced = false;
    const items: InAppNotice[] = [];
    for (const item of queue.items) {
      if (semanticNoticeKey(item) !== semanticKey) {
        items.push(item);
        continue;
      }
      if (replaced) continue;
      // Keep the card's queue identity and position so replacing the visible
      // event does not jump the deck. Content and route come from the latest
      // receipt, including its notification id.
      items.push({ ...notice, id: item.id });
      replaced = true;
    }
    if (replaced) {
      return {
        items,
        seen: [...queue.seen, notice.id].slice(-MAX_SEEN_NOTICES),
      };
    }
  }
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

/**
 * The separator the gateway puts between what happened and where.
 *
 * A push arrives titled "Agent done · osk": one sentence of subject and one
 * word of provenance, joined by a middle dot. The banner draws them as two
 * weights on one line rather than as one string, so the eye reaches the event
 * first and the machine second.
 */
const TITLE_SEPARATOR = ' · ';

export interface NoticeTitleParts {
  /** What happened. Always the whole title when there is nothing to split. */
  lead: string;
  /** Where it happened, if the sender said. Empty otherwise. */
  suffix: string;
}

/**
 * Splits a notice title into the event and its quiet suffix.
 *
 * Only the first separator counts: a title with two dots in it is an event
 * whose own name contains one, and breaking it at the second would put half a
 * sentence in the muted face. Nothing is invented -- a title with no separator
 * comes back whole, with no suffix, and the banner draws one weight.
 */
export function noticeTitleParts(title: string): NoticeTitleParts {
  const at = title.indexOf(TITLE_SEPARATOR);
  const whole = { lead: title.trim(), suffix: '' };
  if (at < 0) return whole;
  const lead = title.slice(0, at).trim();
  const suffix = title.slice(at + TITLE_SEPARATOR.length).trim();
  if (!lead || !suffix) return whole;
  return { lead, suffix };
}
