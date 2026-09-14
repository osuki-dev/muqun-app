import { expect, test } from 'bun:test';
import { localizeDemoWorkResponse } from '../demo-work-localization';

test('demo localization preserves original fixture values and non-summary evidence', () => {
  const source = 'Fictional prior result retained after simulated exit.';
  const original = {
    status: 200,
    body: { results: [{ id: 'saved-version', summary: source, evidence: [source] }] },
  };
  const localized = localizeDemoWorkResponse(original, (text) =>
    text === source ? 'Translated summary' : text
  );
  expect(localized.body).toEqual({
    results: [{ id: 'saved-version', summary: 'Translated summary', evidence: [source] }],
  });
  expect(original.body.results[0].summary).toBe(source);
  expect(localizeDemoWorkResponse(original, () => 'Second locale').body).not.toEqual(
    localized.body
  );
});
