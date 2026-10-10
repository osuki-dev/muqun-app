import { describe, expect, test } from 'bun:test';

import { guideCommandAction, guideCommandLines } from '../guide-command';

describe('guideCommandAction: Run only where a pane can open now', () => {
  test.each([
    ['reachable with a terminal', true, true, 'run'],
    ['reachable without a terminal', true, false, 'copy'],
    ['unreachable with a terminal', false, true, 'copy'],
    ['unreachable without a terminal', false, false, 'copy'],
  ] as const)('%s', (_name, reachable, terminal, expected) => {
    expect(guideCommandAction({ reachable, terminal })).toBe(expected);
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
