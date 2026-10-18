import { expect, test } from 'bun:test';

import { transcriptRuleTrim } from '@/constants/transcript-grid';
import { AGENT_TYPE } from '@/constants/agent-type';

test('the rule trims to the text box with matching insets top and bottom', () => {
  const trim = transcriptRuleTrim(AGENT_TYPE.meta.size, AGENT_TYPE.mono.lineHeight);
  expect(trim).toEqual({ top: 4, bottom: 4.5 });
  // Within a point of each other at every size the transcript sets text in.
  for (const { size, lineHeight } of Object.values(AGENT_TYPE)) {
    const { top, bottom } = transcriptRuleTrim(size, lineHeight);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
  }
});
