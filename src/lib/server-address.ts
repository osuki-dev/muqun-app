/**
 * Which server cards have to print their address.
 *
 * The home screen used to print `server.url` under every card's name. On a
 * single-server install that line is a constant -- the reader already knows
 * which machine it is, because there is only one -- and on a multi-server
 * install it is still noise for every machine whose name is unambiguous. An
 * address is a *disambiguator*, so it belongs on screen exactly when it is
 * disambiguating.
 *
 * The full address is never hidden, only relocated: Settings > SERVERS lists
 * every paired server with its address, which is where a reader who wants it
 * goes.
 *
 * This is deliberately a pure module with no Lingui macros in it. `bun test`
 * transpiles with Bun rather than Babel and never expands the macros, so a rule
 * that wants a test suite cannot live beside the view that renders it.
 */

/** The parts of a paired record this rule looks at. */
export type NamedServer = {
  serverId: string;
  label: string;
};

/**
 * Two names collide when they are the same word, which is not the same question
 * as whether they are the same string. `mac-mini` and `Mac-Mini ` are one
 * machine's name typed twice, and a reader scanning the list cannot tell them
 * apart -- so both cards need their address, even though `===` says they differ.
 */
function normalizeName(label: string): string {
  return label.trim().toLocaleLowerCase();
}

/**
 * The ids of the servers whose cards must show an address.
 *
 * Empty when every name is unique, which is the common case and the reason this
 * exists. A server with a blank name is treated as colliding with every other
 * blank name, for the same reason as above: they are indistinguishable on
 * screen.
 */
export function serverIdsNeedingAddress(servers: readonly NamedServer[]): Set<string> {
  const seen = new Map<string, string[]>();
  for (const server of servers) {
    const name = normalizeName(server.label);
    const ids = seen.get(name);
    if (ids) ids.push(server.serverId);
    else seen.set(name, [server.serverId]);
  }

  const needed = new Set<string>();
  for (const ids of seen.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) needed.add(id);
  }
  return needed;
}
