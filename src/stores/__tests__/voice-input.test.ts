import { afterEach, expect, test } from 'bun:test';
import { claimVoiceInput, clearVoiceInput, deliverVoiceInput, useVoiceInput } from '../voice-input';

afterEach(() => useVoiceInput.setState({ request: null }));

test('only one composer can own the microphone, and a different owner cannot cancel it', () => {
  const owner = {};
  expect(claimVoiceInput(owner, 'first', () => {})).toBe(true);
  const request = useVoiceInput.getState().request;
  expect(claimVoiceInput({}, 'second', () => {})).toBe(false);
  clearVoiceInput({});
  expect(useVoiceInput.getState().request).toBe(request);
  clearVoiceInput(owner);
  expect(useVoiceInput.getState().request).toBeNull();
});

test('cancelled and superseded attempts cannot insert a delayed transcript', () => {
  const owner = {};
  const delivered: string[] = [];
  claimVoiceInput(owner, 'first', (text) => delivered.push(text));
  const stale = useVoiceInput.getState().request!;
  clearVoiceInput(owner);
  expect(deliverVoiceInput(stale, 'cancelled')).toBe(false);
  claimVoiceInput(owner, 'second', (text) => delivered.push(text));
  expect(deliverVoiceInput(stale, 'late')).toBe(false);
  const current = useVoiceInput.getState().request!;
  expect(deliverVoiceInput(current, 'new draft')).toBe(true);
  expect(deliverVoiceInput(current, 'duplicate')).toBe(false);
  expect(delivered).toEqual(['new draft']);
  expect(useVoiceInput.getState().request).toBeNull();
});
