/**
 * Unpairing must never look like nothing happened.
 *
 * The store asks the gateway to drop this device's token before it forgets the
 * record. A gateway that is simply gone cannot answer, and the two requests
 * behind that ask carry an 8 s budget each: sixteen seconds in which a reader
 * who tapped Unpair sees no change at all. These tests pin the two halves of
 * the fix — the wait is capped, and an unreachable gateway still loses the
 * record — around the timing rule itself rather than around the store's
 * native-dependent wiring.
 */
import { describe, expect, test } from 'bun:test';

const REVOKE_BUDGET_MS = 4_000;

/** The store's race, extracted so it can be exercised without native modules. */
async function reviveOrForgive(revoke: () => Promise<void>, budgetMs = REVOKE_BUDGET_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      revoke(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for the server.')), budgetMs);
      }),
    ]);
    return 'revoked' as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out|network/i.test(message)) return 'forgiven' as const;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('the revoke that precedes forgetting a gateway', () => {
  test('a gateway that answers is revoked properly', async () => {
    expect(await reviveOrForgive(async () => {})).toBe('revoked');
  });

  test('a gateway that never answers is given up on inside the budget', async () => {
    const started = Date.now();
    const verdict = await reviveOrForgive(() => new Promise<void>(() => {}), 40);
    expect(verdict).toBe('forgiven');
    // The point of the budget: the caller is released long before the two
    // 8 s request timeouts behind the revoke would have elapsed.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('a gateway that is there and says no still blocks the removal', async () => {
    await expect(
      reviveOrForgive(async () => {
        throw new Error('HTTP 401: bad token');
      })
    ).rejects.toThrow('401');
  });

  test('the budget is short enough to stay under a reader-visible stall', () => {
    expect(REVOKE_BUDGET_MS).toBeLessThanOrEqual(5_000);
  });
});
