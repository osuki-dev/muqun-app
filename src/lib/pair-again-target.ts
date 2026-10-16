/**
 * Which address the pairing screen may start with when it is opened to pair
 * a computer again.
 *
 * Only an address this device already holds, looked up by the record's own
 * id. The screen never takes a URL from its route parameters: the app answers
 * the `muqun://` scheme, so any app or page could open
 * `muqun://explore?url=http://attacker:23847`, show the familiar "pair again"
 * form, and collect a freshly minted one-time code to replay against the real
 * gateway inside its lifetime. A `serverId` that names no record, or a
 * tunnelled record whose stored address belongs to the SSH host, opens the
 * ordinary blank flow.
 */
export function pairAgainAddress(
  params: Readonly<Record<string, unknown>>,
  records: readonly { serverId: string; url: string; sshTunnel?: unknown }[]
): string {
  const serverId = params.serverId;
  if (typeof serverId !== 'string' || !serverId) return '';
  const record = records.find((entry) => entry.serverId === serverId);
  if (!record || record.sshTunnel) return '';
  return record.url;
}
