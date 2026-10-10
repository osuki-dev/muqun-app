import { describe, expect, test } from 'bun:test';

import { guideCommandAction, guideCommandLines, type GuideCommandAction } from '../guide-command';
import type { ConnectionStatus } from '../server-reachability';

describe('guideCommandAction: Run only where a pane can open now', () => {
  test.each<
    [string, ConnectionStatus, { supported: boolean } | undefined, boolean, GuideCommandAction]
  >([
    ['live, the gateway said nothing about its terminal', 'live', undefined, false, 'run'],
    ['live, but its terminal plane is unsupported', 'live', { supported: false }, false, 'copy'],
    ['live, but its terminal backend is down', 'live', { supported: true }, true, 'copy'],
    ['reconnecting is not answering yet', 'reconnecting', undefined, false, 'copy'],
    ['a refused pairing cannot open a pane', 'unauthorized', undefined, false, 'copy'],
    ['nobody asked recently', 'unknown', undefined, false, 'copy'],
  ])('%s', (_name, status, terminalPlane, terminalDown, expected) => {
    expect(
      guideCommandAction({
        status,
        ...(terminalPlane ? { terminalPlane } : {}),
        terminalDown,
      })
    ).toBe(expected);
  });
});

describe('guideCommandLines: what is typed, each line then Enter', () => {
  test.each([
    ['one line', 't3code --version', ['t3code --version']],
    [
      'several lines, blank ones left out, sudo as written',
      'cd ~/app\n\nsudo systemctl restart t3\r\nt3code --version',
      ['cd ~/app', 'sudo systemctl restart t3', 't3code --version'],
    ],
  ] as const)('%s', (_name, command, expected) => {
    expect(guideCommandLines(command)).toEqual([...expected]);
  });
});
