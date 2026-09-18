// Where `lib/push-token-rule`'s answer is written down.
//
// The rule itself is next door and free of React Native, so it can be tested
// without a device, a mock or the MMKV binding this file needs. Keeping them
// apart is not tidiness: a suite that has to load `react-native-mmkv` to ask
// whether a token is due can only run when some other suite happens to have
// mocked it first, which is exactly how this file's own tests came to pass
// only as part of the full run.

import { createMMKV } from 'react-native-mmkv';

import type { RegisteredPushToken } from '@/lib/push-token-rule';

export {
  PUSH_TOKEN_MAX_AGE_MS,
  pushTokenNeedsSending,
  type RegisteredPushToken,
} from '@/lib/push-token-rule';

const STORE_ID = 'muqun.push-tokens';

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
    if (typeof parsed?.token !== 'string' || typeof parsed?.build !== 'string') return null;
    // A record with no usable timestamp reads as epoch, which rule 4 treats as
    // long overdue. That is the safe direction: one request, rather than a
    // registration that can never expire.
    const atMs = typeof parsed.atMs === 'number' && Number.isFinite(parsed.atMs) ? parsed.atMs : 0;
    return { token: parsed.token, build: parsed.build, atMs };
  } catch {
    return null;
  }
}

/**
 * Written only after the gateway has actually accepted the token.
 *
 * The time is stamped here rather than passed in, because "when the gateway
 * confirmed it" is exactly the moment this is called, and rule 4 is only honest
 * if nothing else can claim otherwise.
 */
export function rememberRegisteredPushToken(
  serverId: string,
  entry: Omit<RegisteredPushToken, 'atMs'>,
  nowMs: number = Date.now()
): void {
  if (!serverId || !entry.token) return;
  try {
    storage?.set(serverId, JSON.stringify({ ...entry, atMs: nowMs }));
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
