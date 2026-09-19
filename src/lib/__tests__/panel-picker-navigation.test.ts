import { expect, test } from 'bun:test';

import { panelPickerDestination } from '../panel-picker-navigation';

test('Home terminal creation keeps backend selection in the picker', () => {
  for (const embedded of [true, false]) {
    for (const sameServer of [true, false]) {
      expect(
        panelPickerDestination({ newTerminal: true, embedded, choice: 'session', sameServer })
      ).toBe('picker');
    }
  }
});

test('a created or selected pane from compact Home opens its workspace', () => {
  expect(
    panelPickerDestination({
      newTerminal: true,
      embedded: false,
      choice: 'pane',
      sameServer: true,
    })
  ).toBe('workspace');
});

test('embedded workspace picks return to the existing task owner', () => {
  for (const newTerminal of [true, false]) {
    expect(
      panelPickerDestination({ newTerminal, embedded: true, choice: 'pane', sameServer: true })
    ).toBe('previous');
  }
});

test('ordinary backend switching preserves existing navigation behavior', () => {
  expect(
    panelPickerDestination({
      newTerminal: false,
      embedded: false,
      choice: 'session',
      sameServer: true,
    })
  ).toBe('previous');
  expect(
    panelPickerDestination({
      newTerminal: false,
      embedded: false,
      choice: 'session',
      sameServer: false,
    })
  ).toBe('workspace');
});
