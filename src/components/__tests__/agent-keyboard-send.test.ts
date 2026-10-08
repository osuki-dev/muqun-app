import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workbench = readFileSync('src/components/agent-workbench.tsx', 'utf8');

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
