import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  composerDelivery,
  homeBoundary,
  inputAdapter,
  paneShape,
  parse,
  sshDialogs,
} from '../../../tooling/oxlint/source-contracts';

test('Reanimated rule loads in Oxlint and handles aliases, namespaces and argument positions', () => {
  execFileSync('node', ['tooling/oxlint/reanimated.check.ts'], { stdio: 'pipe' });
});

const source = (path: string) => readFileSync(path, 'utf8');
const workspace = 'src/components/server-terminal-workspace.tsx';
test('pane shape lint detects an extra cache identity and a missing screen component', () => {
  const text = source(workspace);
  expect(paneShape(parse(workspace, text))).toEqual([]);
  expect(
    paneShape(parse(workspace, `${text}\nconst bad = \`${'${PANE_OUTPUT_FORMAT}'}:extra\`;`))
  ).not.toEqual([]);
  expect(
    paneShape(parse(workspace, text.replace(":${ownsScreen ? 'alt' : 'main'}", '')))
  ).not.toEqual([]);
});
test('composer lint rejects waiting for output rather than delivery', () => {
  const text = source(workspace);
  expect(composerDelivery(parse(workspace, text))).toEqual([]);
  expect(
    composerDelivery(
      parse(workspace, text.replace('await sendPaneCharacters(', 'await refreshOutput('))
    )
  ).not.toEqual([]);
});
test('SSH dialog lint catches losing handoff and keyboard submission', () => {
  const path = 'src/components/ssh-host-key-dialog.tsx';
  const text = source(path);
  expect(sshDialogs(parse(path, text))).toEqual([]);
  expect(
    sshDialogs(parse(path, text.replaceAll('useModalHandoff()', 'useOtherHook()')))
  ).not.toEqual([]);
  expect(sshDialogs(parse(path, text.replaceAll('onSubmitEditing=', 'onBlur=')))).not.toEqual([]);
});
test('input lint compares the installed kit contract and catches event loss', () => {
  const path = 'src/components/themed-input.tsx';
  const text = source(path);
  expect(inputAdapter(parse(path, text), 'input', process.cwd())).toEqual([]);
  expect(
    inputAdapter(parse(path, text.replace('onFocus={handleFocus}', '')), 'input', process.cwd())
  ).not.toEqual([]);
});
test('Home boundary permits type-only transport imports and rejects runtime adapters', () => {
  const file = resolve('src/lib/home-layout.ts');
  const src = resolve('src');
  expect(
    homeBoundary(file, parse(file, "import type { GatewayRecord } from './gateway-storage';"), src)
  ).toEqual([]);
  expect(
    homeBoundary(file, parse(file, "import { readGatewaySnapshot } from './gateway-storage';"), src)
  ).toHaveLength(1);
  expect(homeBoundary(file, parse(file, 'import(target);'), src)).toHaveLength(1);
});
