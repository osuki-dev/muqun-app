import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  buildLaunchModel,
  LAUNCH_SCROLL_MAX_WIDTH,
  launchRowLayout,
} from '../../lib/home-launch-model';

const actions = readFileSync(new URL('../home-launch-actions.tsx', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../home-overview.tsx', import.meta.url), 'utf8');

const discoveryWith = (ids: string[]) =>
  ({
    checkedAtMs: 1,
    agents: {
      supported: true,
      features: {},
      agents: ids.map((id) => ({
        id,
        kind: id,
        name: id,
        enabled: true,
        status: 'connected',
        features: {},
      })),
    },
  }) as unknown as NonNullable<Parameters<typeof buildLaunchModel>[0]>['discovery'];

test('the phone row is unchanged: it scrolls under 560pt and wraps above', () => {
  const phone = { grid: false, agentCount: 3, utilityCount: 4 };
  expect(launchRowLayout({ ...phone, width: 0 })).toEqual({ mode: 'scroll' });
  expect(launchRowLayout({ ...phone, width: 375 })).toEqual({ mode: 'scroll' });
  expect(launchRowLayout({ ...phone, width: LAUNCH_SCROLL_MAX_WIDTH })).toEqual({ mode: 'wrap' });
  // Same tiles, same collapse: three agents, then "More agents".
  const kinds = buildLaunchModel({ discovery: discoveryWith(['a', 'b', 'c', 'd']) }).entries.map(
    (entry) => entry.kind
  );
  expect(kinds.slice(0, 4)).toEqual(['agent', 'agent', 'agent', 'more-agents']);
});

test('a Pad Home lays the launch area out as a grid and never scrolls sideways', () => {
  const wide = launchRowLayout({ width: 930, grid: true, agentCount: 3, utilityCount: 4 });
  expect(wide).toEqual({
    mode: 'grid',
    columns: 4,
    agentColumns: 3,
    agentWidth: 304,
    utilityColumns: 4,
    utilityWidth: 226,
  });
  // The cover-artwork column on a tablet is narrow: still a grid, three across.
  const cover = launchRowLayout({ width: 370, grid: true, agentCount: 3, utilityCount: 4 });
  expect(cover).toMatchObject({ mode: 'grid', columns: 3, agentColumns: 3, utilityColumns: 2 });
  for (const width of [0, 320, 560, 900, 1400]) {
    expect(launchRowLayout({ width, grid: true, agentCount: 5, utilityCount: 4 }).mode).toBe(
      'grid'
    );
  }
  // Every agent gets a tile; nothing collapses behind "More agents".
  const padKinds = buildLaunchModel({
    discovery: discoveryWith(['a', 'b', 'c', 'd']),
    maxAgentTiles: Number.POSITIVE_INFINITY,
  }).entries.map((entry) => entry.kind);
  expect(padKinds).toEqual([
    'agent',
    'agent',
    'agent',
    'agent',
    'sessions',
    'terminal',
    'new-terminal',
    'ssh',
  ]);
  // The grid branch draws plain rows; the only ScrollView is the phone's.
  const gridBranch = actions.slice(
    actions.indexOf('testID="home-launch-actions-grid"'),
    actions.indexOf('<Animated.ScrollView')
  );
  expect(gridBranch).toContain('renderEntry(entry, { width: layout.agentWidth, compact: false })');
  expect(gridBranch).toContain('renderEntry(entry, { width: layout.utilityWidth, compact: true })');
  expect(gridBranch).not.toContain('ScrollView');
  expect(actions).toContain('grid = false');
  expect(overview).toContain('grid={isPad}');
});

test('the embedded Pad Home does not repeat the brand the rail carries', () => {
  expect(overview).toContain('identity.showBrand && !(embedded && isPad)');
  expect(overview).toContain('showsEditorialBrand ? (');
  expect(overview).toContain('pad={isPad}');
});

test('Editorial Home scrolls narrow actions and wraps wide actions', () => {
  expect(actions).toContain('horizontal={horizontal}');
  expect(actions).toContain("const horizontal = layout.mode === 'scroll'");
  expect(actions).toContain('testID="home-launch-actions-scroll"');
  expect(actions).toContain('flexBasis: 124');
  expect(actions).toContain('primaryTile: { flexBasis: 148');
  expect(actions).toContain("flexWrap: 'wrap'");
  expect(actions).toContain('minHeight: 104');
  expect(actions).toContain('minHeight: 44');
  expect(actions.slice(actions.indexOf('function LaunchTile'))).not.toContain('numberOfLines=');
});

test('the launch row is drawn from the projection, not from a fixed list', () => {
  expect(actions).toContain('buildLaunchModel({\n    discovery,\n    lastUsedAgentId,');
  expect(actions).toContain('groupLaunchCells(model.entries)');
  // Markers come from the model, so no tile hard-codes its own number.
  expect(/marker="\d\d"/.test(actions)).toBe(false);
  // Every tile kind the model can emit has a renderer.
  for (const kind of ['agent', 'more-agents', 'sessions', 'terminal', 'new-terminal', 'ssh']) {
    expect(actions).toContain(`case '${kind}':`);
  }
});

test("the fixed row keeps today's order and marker numbers", () => {
  const fixed = buildLaunchModel().entries;
  expect(fixed.map((entry) => [entry.marker, entry.testID])).toEqual([
    ['01', 'home-new-agent-opencode'],
    ['02', 'home-open-sessions'],
    ['03', 'home-open-terminal'],
    ['04', 'home-new-terminal'],
    ['05', 'home-open-ssh'],
  ]);
  // The manifest's old ids stay reachable as aliases on the same tiles.
  expect(fixed.flatMap((entry) => ('aliasTestID' in entry ? [entry.aliasTestID] : []))).toEqual([
    'home-new-opencode',
    'home-open-opencode',
  ]);
  expect(actions).toContain('nativeID={aliasTestID}');
});

test('view actions reuse the selected Gateway command owners', () => {
  expect(actions).toContain(
    'launchOnChosen((serverId) => onNewAgent(serverId, undefined, entry.agentId))'
  );
  expect(actions).toContain('onPress={() => launchOnChosen(onOpenAgent)}');
  expect(actions).toContain('onPress={() => launchOnChosen(onOpenTerminal)}');
  expect(overview).toContain('onOpenAgent={commands.openAgent}');
  expect(overview).toContain('onNewAgent={commands.newAgent}');
  expect(overview).toContain('onOpenTerminal={commands.openServer}');
});

test('the Gateway target is a separate 44-point masthead control', () => {
  expect(actions).toContain('export function HomeLaunchTarget');
  expect(actions).toContain('minHeight: 44');
  expect(overview).toContain('headerLeading={');
  expect(overview).toContain('<HomeLaunchTarget');
  expect(overview).toContain('controller={launchController}');
});

test('launch feedback is restrained and reduced-motion safe', () => {
  expect(actions).toContain('useReducedMotion()');
  expect(actions).toContain('pressed && !reduceMotion ? 2 : 0');
  expect(actions).toContain('pickerOpen.get() * 180');
  expect(actions).toContain('onPressIn={() => moveArrow(true)}');
  expect(actions).toContain('onPressOut={() => moveArrow(false)}');
});
