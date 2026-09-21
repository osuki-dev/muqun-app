import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const actions = readFileSync(new URL('../home-launch-actions.tsx', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../home-overview.tsx', import.meta.url), 'utf8');

test('Editorial Home presents wide quick actions as one horizontal rail with SSH last', () => {
  expect(actions).toContain('<ScrollView\n        horizontal');
  expect(actions).toContain('testID="home-launch-actions-scroll"');
  expect(actions).toContain('width: 124');
  expect(actions).toContain('primaryTile: { width: 148');
  expect(actions).toContain("actions: { flexDirection: 'row', alignItems: 'flex-start', gap: 4");
  expect(actions).toContain('stackedActions: { width: 152, gap: 4 }');
  expect(actions).toContain('minHeight: 92');
  expect(actions).toContain('minHeight: 44');
  expect(actions).toContain('marker="01"');
  expect(actions).toContain('marker="05"');
  expect(actions.slice(actions.indexOf('function LaunchTile'))).not.toContain('numberOfLines=');

  const ids = [
    'home-new-opencode',
    'home-open-opencode',
    'home-open-terminal',
    'home-new-terminal',
    'home-open-ssh',
  ];
  const positions = ids.map((id) => actions.indexOf(`testID="${id}"`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
});

test('view actions reuse the selected Gateway command owners', () => {
  expect(actions).toContain('onPress={() => launchOnChosen(onOpenOpenCode)}');
  expect(actions).toContain('onPress={() => launchOnChosen(onOpenTerminal)}');
  expect(overview).toContain('onOpenOpenCode={commands.openOpenCode}');
  expect(overview).toContain('onOpenTerminal={commands.openServer}');
});

test('the Gateway target is a separate 44-point masthead control', () => {
  expect(actions).toContain('export function HomeLaunchTarget');
  expect(actions).toContain('height: 44');
  expect(overview).toContain('headerLeading={');
  expect(overview).toContain('<HomeLaunchTarget');
  expect(overview).toContain('controller={launchController}');
});

test('launch feedback is restrained and reduced-motion safe', () => {
  expect(actions).toContain('useReducedMotion()');
  expect(actions).toContain('pressed && !reduceMotion ? 2 : 0');
  expect(actions).toContain('pickerOpen.value * 180');
  expect(actions).toContain('onPressIn={() => moveArrow(true)}');
  expect(actions).toContain('onPressOut={() => moveArrow(false)}');
});
