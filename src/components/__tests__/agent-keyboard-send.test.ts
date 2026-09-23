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
  expect(sendScroll).toContain('listRef.current?.scrollToEnd({ animated: false })');
  expect(sendScroll).not.toContain('KeyboardController.dismiss');
  expect(sendScroll).not.toContain('followAfterSend');
});

test('keyboard inset reactions stay active while an explicit end scroll awaits row measurement', () => {
  // Native regression: append beyond the viewport, then dismiss the keyboard
  // before the end-scroll promise settles. Freezing the keyboard integration
  // leaves the offset beyond the closed-keyboard content range on Android.
  expect(workbench).not.toContain('useKeyboardScrollToEnd');
  expect(workbench).not.toContain('freeze={');
  const start = workbench.indexOf('const handleJumpToLatest =');
  const end = workbench.indexOf('// YOLO', start);
  expect(workbench.slice(start, end)).toContain(
    'listRef.current?.scrollToEnd({ animated: false })'
  );
});
