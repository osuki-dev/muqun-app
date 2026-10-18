import { expect, test } from 'bun:test';
import { noticeDeckPage } from '../notice-deck';

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
