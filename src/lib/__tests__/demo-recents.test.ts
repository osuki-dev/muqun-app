import * as bunTest from 'bun:test';
import { readFileSync } from 'node:fs';
import { fakeSecureStore } from './gateway-vault';
import { homeContinueCommand } from '../home-continue';

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

test('fixture entries have unique navigable demo targets and no invented observations', () => {
  const entries = demoContinueSearchEntries('16', true) ?? [];
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(16);
  for (const [index, entry] of entries.entries()) {
    const command = homeContinueCommand(entry.destination);
    expect(command.type).toBe('open-agent');
    expect(entry.destination.type).toBe('agent-session');
    if (entry.destination.type === 'agent-session') {
      expect(entry.destination.target.asid).toBe(`demo-tree-leaf-${index + 1}`);
      expect(entry.destination.target.sessionId).toBe('demo');
      expect(entry.destination.target.agentId).toBe('opencode');
    }
    expect(entry.observation).toBeUndefined();
  }
  // These are existing demo snapshot targets, not new opaque ids with no output.
  const demo = readFileSync(new URL('../demo-gateway.ts', import.meta.url), 'utf8');
  expect(demo).toContain('Array.from({ length: 24 }');
  expect(demo).toContain('`demo-tree-leaf-${index + 1}`');
  expect(entries[15].title).toBe('Demo search hidden leaf');
});
