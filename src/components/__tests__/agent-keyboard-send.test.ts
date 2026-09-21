import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workbench = readFileSync('src/components/agent-workbench.tsx', 'utf8');

test('sending coordinates the optimistic row with keyboard dismissal only near the end', () => {
  const threshold = workbench.indexOf(
    'listRef.current?.getState().isWithinMaintainScrollAtEndThreshold'
  );
  const optimistic = workbench.indexOf('setTimeline((prev) => [...prev, tempUserItem])', threshold);
  const guard = workbench.indexOf('if (followAfterSend)', optimistic);
  const frame = workbench.indexOf('requestAnimationFrame(() => {', guard);
  const coordinatedScroll = workbench.indexOf(
    'scrollMessageToEnd({ animated: true, closeKeyboard: true })',
    frame
  );

  expect(threshold).toBeGreaterThan(-1);
  expect(optimistic).toBeGreaterThan(threshold);
  expect(guard).toBeGreaterThan(optimistic);
  expect(frame).toBeGreaterThan(guard);
  expect(coordinatedScroll).toBeGreaterThan(frame);
});
