import { expect, test } from 'bun:test';
import { noticeDeckPage } from '../notice-deck';
import { sheetPresentationOptions } from '../route-presentation';
import { appChrome } from '@/constants/appearance';

test('empty notices do not reserve a page and removed selections recover', () => {
  const page = noticeDeckPage(
    ['connection', 'task', 'switch'],
    { connection: 0, task: 80, switch: 30 },
    'connection'
  );
  expect(page).toEqual({ visible: ['task', 'switch'], front: 'task', position: 0, next: 'switch' });
  expect(noticeDeckPage(['task', 'switch'], { task: 80, switch: 30 }, 'switch').next).toBe('task');
  expect(noticeDeckPage([], {}, 'removed').front).toBeUndefined();
});

test('full-screen browsing has no sheet dismissal gesture or detents', () => {
  const options = sheetPresentationOptions('fullscreen');
  expect(options.presentation).toBe('fullScreenModal');
  expect(options.gestureEnabled).toBe(false);
  expect(options.sheetAllowedDetents).toBeUndefined();
  expect(sheetPresentationOptions('sheet').sheetAllowedDetents).toEqual([1]);
  expect(sheetPresentationOptions('sheet', 'fitToContents').sheetAllowedDetents).toBe(
    'fitToContents'
  );
  expect(sheetPresentationOptions('sheet', 'expandable').sheetAllowedDetents).toEqual([0.82, 1]);
  expect(sheetPresentationOptions('sheet', [0.65, 0.9]).sheetAllowedDetents).toEqual([0.65, 0.9]);
  // One radius for every sheet, and the full-screen route has no sheet to
  // round: leaving it unset is what let iOS and Android disagree.
  expect(sheetPresentationOptions('sheet').sheetCornerRadius).toBe(appChrome.radius.sheet);
  expect(options.sheetCornerRadius).toBeUndefined();
});
