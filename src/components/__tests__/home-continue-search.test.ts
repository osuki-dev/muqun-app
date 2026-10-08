import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const overview = readFileSync(new URL('../home-overview.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../home-editorial-layout.tsx', import.meta.url), 'utf8');
const recent = readFileSync(new URL('../home-recent-sessions.tsx', import.meta.url), 'utf8');
const fixtureFlow = readFileSync(
  new URL('../../../e2e/agent-device/flows/home-continue-search.ad', import.meta.url),
  'utf8'
);

test('all editorial branches replace their heading, not append a second search row', () => {
  expect(layout.match(/heading=\{recentHeading\}/g)).toHaveLength(3);
  expect(layout).toContain('{recentHeading ? (');
  expect(overview.match(/query=\{recentQuery\}/g)).toHaveLength(1);
  expect(overview).toContain('recentHeading={recentHeading}');
  expect(overview).toContain('homeContinueSearchEnabled(recentEntries.length)');
  const classic = overview.slice(overview.indexOf('const classicContent'));
  expect(classic).not.toContain('<HomeRecentSessions');
});

test('search and clear have accessible labels and no matches has its own message', () => {
  expect(recent).toContain('accessibilityLabel={t`Search sessions`}');
  expect(recent).toContain('accessibilityLabel={t`Clear session search`}');
  expect(recent).toContain("onPress={() => onChange('')}");
  expect(recent).toContain('testID="home-continue-no-matches"');
});

test('provider ink is restricted to metadata Text, leaving the mark and title unchanged', () => {
  expect(recent.match(/color=\{homeProviderTextColor\(/g)).toHaveLength(2);
  expect(recent).toContain('<AgentMark kind={agentKind} size={14} color={theme.colors.primary} />');
  expect(recent).toContain(
    'variant="bodySmall" weight="semibold" numberOfLines={2} style={styles.title}'
  );
  expect(recent).not.toContain('backgroundColor: homeProviderTextColor');
});

test('native fixture waits for the layout picker and keeps the active-demo gate', () => {
  expect(fixtureFlow).toContain('open "muqun:///settings-home-layout"');
  expect(fixtureFlow).not.toContain('open "muqun://settings-home-layout"');
  expect(fixtureFlow).toContain('# section picker-ready\nis visible "${TARGET}"');
  expect(fixtureFlow).toContain('# section picker-closed\nis hidden "${TARGET}"');
  expect(overview).toContain(
    'demoContinueSearchEntries(homeContinueFixture, isDemoRecord(record))'
  );
});
