// What this device has already told each gateway about its push token.
//
// The registration used to remember one token in a closure local, which meant
// it remembered nothing: the effect is keyed on the connection record, and
// `stores/gateway-connection` hands back a new object on select, rename and
// edit. Renaming a server -- or anything else that produced a new record for
// the same machine -- tore the effect down, lost the local, and posted an
// unchanged token to a gateway that already had it.
//
// ## The rule
//
// The gateway is told when, and only when, one of these is true:
//
//  1. **This device has never told *this server*.** A fresh install has an
//     empty store, so the first launch registers with every server it connects
//     to, exactly as before.
//  2. **The token changed.** Expo can reissue one; a gateway holding the old
//     one would push into a void.
//  3. **The app binary changed.** A new build is the one moment worth spending
//     a request to re-assert on, because it is the only thing that can change
//     how the token is obtained or what the gateway should record beside it --
//     and because it is the one repair available to a device whose gateway lost
//     its token without saying so. `expo-application`'s version and build
//     number are the identity; on web both are null, which collapses to a
//     single stable value and is correct, because there is no push token there
//     to register.
//
// Everything else is silence. A re-render, a rename, a reselect, a return to
// the foreground: the token and the server are the same, the gateway already
// knows, and the request is not made.
//
// The cost of that silence is that a gateway which drops its device row -- a
// reinstall, a restore from an old backup -- is not told again until the app is
// next updated or the token rotates. That is a deliberate trade: re-posting on
// every foreground to cover it is how this became a request on every launch in
// the first place, and re-pairing, which is what such a gateway needs anyway,
// clears the record for that server.

import { createMMKV } from 'react-native-mmkv';

const STORE_ID = 'muqun.push-tokens';

/** What was last successfully posted, for one server. */
export interface RegisteredPushToken {
  token: string;
  /** The app binary that posted it -- see rule 3. */
  build: string;
}

/**
 * Whether the gateway has to be told, given what it was last told.
 *
 * Pure, and separate from the storage, because this is the decision that can be
 * wrong on its own. Erring towards `true` costs one request; erring towards
 * `false` means notifications silently stop arriving.
 */
export function pushTokenNeedsSending(
  stored: RegisteredPushToken | null,
  token: string,
  build: string
): boolean {
  if (!token) return false;
  if (!stored) return true;
  return stored.token !== token || stored.build !== build;
}

const storage = (() => {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    // Web, or a platform without MMKV. Nothing is remembered, so the rule falls
    // back to registering once per launch -- which is what it did before.
    return null;
  }
})();

export function registeredPushToken(serverId: string): RegisteredPushToken | null {
  if (!serverId) return null;
  try {
    const raw = storage?.getString(serverId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RegisteredPushToken>;
    return typeof parsed?.token === 'string' && typeof parsed?.build === 'string'
      ? { token: parsed.token, build: parsed.build }
      : null;
  } catch {
    return null;
  }
}

/** Written only after the gateway has actually accepted the token. */
export function rememberRegisteredPushToken(serverId: string, entry: RegisteredPushToken): void {
  if (!serverId || !entry.token) return;
  try {
    storage?.set(serverId, JSON.stringify(entry));
  } catch {
    // A write that fails costs one request next launch, and nothing else.
  }
}

/**
 * Forget one server, or every server.
 *
 * Every server is what turning notifications off means: the device token is
 * revoked at the OS level, so nothing any gateway holds is valid any more and
 * turning them back on has to tell all of them again.
 */
export function forgetRegisteredPushToken(serverId?: string): void {
  try {
    if (serverId === undefined) storage?.clearAll();
    else storage?.remove(serverId);
  } catch {
    // Leaving a stale entry behind only costs a skipped re-post, which the
    // next token change or app update corrects.
  }
}
