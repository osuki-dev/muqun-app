import { expect, test } from 'bun:test';

import {
  TRANSCRIPT_GRID,
  TRANSCRIPT_HANG,
  TRANSCRIPT_RULE_X,
  transcriptRuleTrim,
} from '@/constants/transcript-grid';
import { AGENT_TYPE } from '@/constants/agent-type';

const G = TRANSCRIPT_GRID;

test('the columns add up: inset + marker + gap is the text origin', () => {
  expect(G.inset + G.markerWidth + G.markerGap).toBe(G.textOrigin);
  expect(TRANSCRIPT_HANG).toBe(G.textOrigin - G.inset);
});

test('the hanging rule is centred in the marker column', () => {
  const ruleCentre = TRANSCRIPT_RULE_X + G.ruleWidth / 2;
  const markerCentre = G.inset + G.markerWidth / 2;
  expect(ruleCentre).toBe(markerCentre);
  expect(TRANSCRIPT_RULE_X).toBeGreaterThanOrEqual(G.inset);
  expect(TRANSCRIPT_RULE_X + G.ruleWidth).toBeLessThanOrEqual(G.inset + G.markerWidth);
});

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

test('the rhythm: rows are a full gap apart, a block sits closer to its own marker row', () => {
  expect(G.attachGap).toBeLessThan(G.rowGap);
  expect(G.rowGap % 2).toBe(0); // split evenly above and below each row
});
