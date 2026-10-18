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
//  4. **The last confirmed registration is over a week old.** The other three
//     rules all describe something changing on *this* device, and a gateway can
//     lose its device row without anything here changing at all -- a reinstall,
//     a restore from an older backup, a dropped database. Nothing about that is
//     visible from the app: the token still looks registered, and pushes simply
//     stop arriving, silently and indefinitely.
//
//     So the app re-asserts on a timer as well. Seven days is chosen to be far
//     longer than any normal usage pattern -- so it never competes with rules 1
//     to 3 and never shows up as a per-launch cost -- while still bounding how
//     long a gateway can be wrong. A device that opens the app daily spends one
//     request a week per server on this; one that opens it monthly spends one
//     per visit. Either way a gateway that lost its row is told again within a
//     week, with no re-pairing and nothing for the reader to do.
//
//     A stored time in the future -- a clock moved back, a restored backup --
//     counts as overdue rather than as six days of credit.
//  5. **The Gateway advertises device-owned tokens, without a matching receipt.**
//     A legacy token needs one authenticated registration for this pairing;
//     only a successful reply writes that receipt. The weekly repair still applies.
//
// Everything else is silence. A re-render, a rename, a reselect, a return to
// the foreground: the token and the server are the same, the gateway already
// knows, and the request is not made.

/** How long a confirmed registration speaks for the present -- see rule 4. */
export const PUSH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PUSH_TOKEN_OWNER_BINDING_CAPABILITY = 'push_token_owner_binding_v1';

/** Confirmed under this capability and this pairing; never inferred from Gateway versions. */
export interface PushTokenOwnerBinding {
  revision: 1;
  deviceId?: string;
  /** SHA-256 pairing identity, including legacy records that have no device ID. No credential bytes. */
  identity: string;
}

/** What was last successfully posted, for one server. */
export interface RegisteredPushToken {
  token: string;
  /** The app binary that posted it -- see rule 3. */
  build: string;
  /** When the gateway confirmed it, ms since epoch -- see rule 4. */
  atMs: number;
  /**
   * The language the gateway was told to write this device's notifications in.
   *
   * The gateway writes the push itself -- "Agent done", "claude finished
   * running." -- in the locale recorded with the token, so the token is only
   * half of what was registered. Without this, a reader who switched to Thai
   * went on receiving Chinese banners for up to a week: the token had not
   * changed, so nothing was owed. Absent on entries written before this field
   * existed, which reads as "unknown" and is sent again once.
   */
  locale?: string;
  ownerBinding?: PushTokenOwnerBinding;
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
  build: string,
  nowMs: number = Date.now(),
  locale?: string,
  ownerBinding?: PushTokenOwnerBinding
): boolean {
  if (!token) return false;
  if (!stored) return true;
  if (stored.token !== token || stored.build !== build) return true;
  // Only compared when the caller names one, so an older caller keeps the
  // behaviour it was written against.
  if (locale !== undefined && stored.locale !== locale) return true;
  if (
    ownerBinding &&
    (stored.ownerBinding?.revision !== ownerBinding.revision ||
      stored.ownerBinding.identity !== ownerBinding.identity ||
      stored.ownerBinding.deviceId !== ownerBinding.deviceId)
  )
    return true;
  // Rule 4. Written as "is this age inside the window" rather than "is it past
  // it" so that a negative age -- a clock moved back, a restored backup -- is
  // overdue rather than a week of credit.
  const age = nowMs - stored.atMs;
  return !(age >= 0 && age < PUSH_TOKEN_MAX_AGE_MS);
}
