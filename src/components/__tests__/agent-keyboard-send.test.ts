import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workbench = readFileSync('src/components/agent-workbench.tsx', 'utf8');

test('explicit sends reach the newest row without dismissing the keyboard or animating the offset', () => {
  const start = workbench.indexOf('setTimeline((prev) => [...prev, tempUserItem])');
  const end = workbench.indexOf('// No optimistic title.', start);
  const sendScroll = workbench.slice(start, end);
  expect(start).toBeGreaterThan(-1);
  expect(sendScroll).toContain('requestAnimationFrame');
  expect(sendScroll).toContain('activeAsidRef.current !== currentAsid');
  expect(sendScroll).toContain('scrollMessageToEnd({ animated: false, closeKeyboard: false })');
  expect(sendScroll).not.toContain('followAfterSend');
});
