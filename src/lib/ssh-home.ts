/**
 * What the home screen and the Pad rail show of the saved SSH hosts, decided
 * without a component in sight.
 *
 * The host list (`/ssh`) is the place a host is added, edited and forgotten;
 * the home screen is where one already configured is *opened*. The rules for
 * that second surface are small and worth pinning down under `bun test`:
 * which hosts appear (none at all until there is something to show, the demo
 * host only while the demo is on), in what order (the one connected to most
 * recently first, so the row a reader wants is the row under their thumb),
 * and how a row describes itself. Nothing here touches the keychain, the
 * store or Lingui -- the wording of the age is the component's business, for
 * the reason `i18n/labels.ts` gives at length.
 */
import { type SshHostRecord, sshHostAddress } from '@/lib/ssh-hosts';

/**
 * How long ago a host was last connected to, as a bucket and a count.
 *
 * A bucket rather than a string so the component can say it in whole
 * sentences per unit ("Last connected 5m ago" is English's abbreviation, and
 * a translator needs the sentence). `never` is a host that has been saved but
 * not yet opened, which the row says in as many words rather than leaving the
 * line blank.
 */
export type SshHomeAge =
  | { unit: 'never' }
  | { unit: 'now' }
  | { unit: 'minute' | 'hour' | 'day'; value: number };

export function sshHomeAge(
  record: Pick<SshHostRecord, 'lastConnectedAt'>,
  nowMs: number
): SshHomeAge {
  const at = record.lastConnectedAt;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return { unit: 'never' };
  const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
  if (seconds < 60) return { unit: 'now' };
  if (seconds < 3600) return { unit: 'minute', value: Math.floor(seconds / 60) };
  if (seconds < 86400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
  return { unit: 'day', value: Math.floor(seconds / 86400) };
}

/**
 * The line under a host's name: `user@host`, with the port only when it is
 * not the default. The same address the host list has always shown, so a row
 * reads the same on the home screen as it does on `/ssh`.
 */
export function sshHomeSubtitle(record: Pick<SshHostRecord, 'host' | 'port' | 'username'>): string {
  return sshHostAddress(record);
}

/**
 * Most recently connected first, then by name, then newest first.
 *
 * Different from the store's own order (`sortSshHosts`, which breaks ties on
 * creation time) on purpose: a home screen is read top to bottom by a person
 * looking for one name, and among hosts that have never been opened the
 * alphabet is the order they can predict.
 */
export function sortSshHomeHosts(hosts: readonly SshHostRecord[]): SshHostRecord[] {
  return [...hosts].sort(
    (a, b) =>
      (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0)
      || a.label.localeCompare(b.label)
      || b.createdAt - a.createdAt
  );
}

/**
 * The rows the home screen lists, in order.
 *
 * Empty when there is nothing to show, which is what hides the section: a
 * reader who has never added a host is not told about a feature by an empty
 * heading. The demo host is the one exception, and only while the demo is on
 * (`demoHost` non-null): it is pinned above the saved hosts, as it is on
 * `/ssh`, so the offline end-to-end flow has a row to tap on a screen that
 * otherwise has none. On its own -- no demo, no hosts -- the demo host stays
 * where it always was, inside `/ssh`.
 */
export function sshHomeRows(
  hosts: readonly SshHostRecord[],
  demoHost: SshHostRecord | null
): SshHostRecord[] {
  const sorted = sortSshHomeHosts(hosts);
  return demoHost ? [demoHost, ...sorted] : sorted;
}
