import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { buildLaunchModel } from '../../lib/home-launch-model';

const actions = readFileSync(new URL('../home-launch-actions.tsx', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../home-overview.tsx', import.meta.url), 'utf8');

test('Editorial Home scrolls narrow actions and wraps wide actions', () => {
  expect(actions).toContain('horizontal={horizontal}');
  expect(actions).toContain('availableWidth < 560');
  expect(actions).toContain('testID="home-launch-actions-scroll"');
  expect(actions).toContain('flexBasis: 124');
  expect(actions).toContain('primaryTile: { flexBasis: 148');
  expect(actions).toContain("flexWrap: 'wrap'");
  expect(actions).toContain('minHeight: 104');
  expect(actions).toContain('minHeight: 44');
  expect(actions.slice(actions.indexOf('function LaunchTile'))).not.toContain('numberOfLines=');
});

test('the launch row is drawn from the projection, not from a fixed list', () => {
  expect(actions).toContain('buildLaunchModel({ discovery, lastUsedAgentId })');
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
