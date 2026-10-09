import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const layout = readFileSync(new URL('../home-editorial-layout.tsx', import.meta.url), 'utf8');
const connections = readFileSync(new URL('../home-connections.tsx', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../home-overview.tsx', import.meta.url), 'utf8');

test('needs-you comes before Continue in every editorial branch', () => {
  const branches = layout.split(/\n {2}if \(|\n {2}return \(/).slice(1);
  let checked = 0;
  for (const branch of branches) {
    const recentAt = branch.indexOf('{recent}');
    if (recentAt < 0) continue;
    const attentionAt = branch.search(/\{(?:hasSlot\(attention\) \? )?attention/);
    expect(attentionAt).toBeGreaterThanOrEqual(0);
    expect(attentionAt).toBeLessThan(recentAt);
    checked += 1;
  }
  expect(checked).toBe(4);
  expect(layout).toContain('const hasAside = hasSlot(connections);');
  expect(layout).not.toContain('t`Connections`');
});

test('a Home computer row targets the composer; a long press opens it', () => {
  expect(connections).toContain(
    'onPress={() => (onSelect ? onSelect(server.serverId) : onOpen(server.serverId))}'
  );
  expect(connections).toContain(
    'onLongPress={onSelect ? () => onOpen(server.serverId) : undefined}'
  );
  expect(overview).toContain('onSelectServer={targetComposer}');
  expect(overview).toContain('targetPulse={composerPulse}');
});

test('the phone composer is kept clear of the keyboard; the Pad keeps its own column', () => {
  expect(overview).toContain('bottomOffset={isPad ? undefined : HOME_COMPOSER_KEYBOARD_OFFSET}');
});
