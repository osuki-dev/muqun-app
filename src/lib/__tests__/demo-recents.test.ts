import * as bunTest from 'bun:test';
import { fakeSecureStore } from './gateway-vault';

const { expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;
mockModule('expo-secure-store', () => fakeSecureStore);
const { demoContinueSearchEntries } = await import('../demo-recents');

test('search fixture is opt-in, exact-sized, and never available for live inventory', () => {
  expect(demoContinueSearchEntries('15', true)).toHaveLength(15);
  expect(demoContinueSearchEntries('16', true)).toHaveLength(16);
  for (const fixture of [undefined, '', '17', '16junk'])
    expect(demoContinueSearchEntries(fixture, true)).toBeUndefined();
  expect(demoContinueSearchEntries('16', false)).toBeUndefined();
});
