import * as bunTest from 'bun:test';

const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

/**
 * Both agent-store suites import the same production singleton. Its MMKV handle
 * survives module mock replacement, so they must observe the same backing map.
 * Keep namespaces separate, as the native module does, and clear maps in place.
 */
const namespaces = new Map<string, Map<string, string>>();
function storageFor(id: string): Map<string, string> {
  let stored = namespaces.get(id);
  if (!stored) {
    stored = new Map();
    namespaces.set(id, stored);
  }
  return stored;
}

export const agentsStorage = storageFor('muqun.agents');

mockModule('react-native-mmkv', () => ({
  createMMKV: ({ id }: { id: string }) => {
    const stored = storageFor(id);
    return {
      getString: (key: string) => stored.get(key),
      set: (key: string, value: string) => {
        stored.set(key, value);
      },
    };
  },
}));
