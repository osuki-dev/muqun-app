import { expect, test } from 'bun:test';
import { goalContinuationSummary } from '../agent-goal-message';

const envelope =
  'Continue the active goal: Fix the Home layout. Continue active goals until their acceptance criteria are verified. Read osuki_goal status. Current acceptance: []';
test('known goal envelope keeps its objective as the folded summary', () => {
  expect(goalContinuationSummary(envelope)).toBe('Fix the Home layout.');
});
test('ordinary requests, quoted envelopes, and incomplete markers stay expanded', () => {
  expect(goalContinuationSummary('Continue the active goal: finish my work')).toBeNull();
  expect(goalContinuationSummary('Explain this message: ' + envelope)).toBeNull();
  expect(goalContinuationSummary(envelope.replace('osuki_goal', 'a tool'))).toBeNull();
  expect(
    goalContinuationSummary(envelope.replace('Current acceptance:', 'Acceptance:'))
  ).toBeNull();
});
