/**
 * The phone's keychain and crypto, stood in for, once — and shared by every
 * suite that needs the real `gateway-storage` underneath it.
 *
 * `mock.module` is process-wide: two suites that each register their own
 * `expo-secure-store` do not get one apiece, they get whichever was registered
 * last, and `gateway-storage` binds to whichever was in place the first time
 * anything imported it. That ordering is invisible until it bites — the suite
 * whose fake lost holds a `vault` nothing writes to any more, so its
 * `beforeEach` quietly stops resetting anything and its tests start seeing each
 * other's records.
 *
 * One vault, mutated rather than reassigned so every closure over it stays
 * live, removes the question. Both suites reset the same object, and it no
 * longer matters which of them bun happens to evaluate first.
 */
import nodeCrypto from 'node:crypto';

/** The keychain's contents. Mutated in place; never reassigned. */
export const vault: Record<string, string> = {};

export function resetVault(): void {
  for (const key of Object.keys(vault)) delete vault[key];
}

/** Enough of `expo-secure-store` for the record store's read-modify-writes. */
export const fakeSecureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: async (key: string) => vault[key] ?? null,
  setItemAsync: async (key: string, value: string) => {
    vault[key] = value;
  },
  deleteItemAsync: async (key: string) => {
    delete vault[key];
  },
};

/** Node's crypto standing in for the phone's, so the sealing is real AES-GCM. */
export const fakeQuickCrypto = {
  default: {
    Buffer,
    randomBytes: (size: number) => nodeCrypto.randomBytes(size),
    createCipheriv: nodeCrypto.createCipheriv,
    createDecipheriv: nodeCrypto.createDecipheriv,
  },
};
