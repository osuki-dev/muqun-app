import { describe, expect, test } from 'bun:test';
import { beginDrawerDust, stepDrawerDust, type DrawerDust } from '../home-reply-dust';

type Shot = { id: string };
const shotA: Shot = { id: 'a' };
const shotB: Shot = { id: 'b' };

const opening = (): DrawerDust<Shot> => beginDrawerDust(1, 'open', 700);
const closing = (): DrawerDust<Shot> => beginDrawerDust(2, 'close', 420);

describe('stepDrawerDust: opening', () => {
  test('plays as soon as the photograph lands, without waiting for the canvas', () => {
    const { next, effects } = stepDrawerDust(opening(), { type: 'shot', token: 1, shot: shotA });
    expect(next).toEqual({ ...opening(), shot: shotA, playing: true });
    expect(effects).toEqual([{ effect: 'play', way: 'open' }]);
  });

  test('a photograph that could not be taken hands the open to the slide', () => {
    expect(stepDrawerDust(opening(), { type: 'shot', token: 1, shot: null })).toEqual({
      next: null,
      effects: [{ effect: 'fallback', way: 'open' }],
    });
  });

  test('a late photograph slides instead; the picture, landing after, is disposed', () => {
    const late = stepDrawerDust(opening(), { type: 'late', token: 1 });
    expect(late).toEqual({ next: null, effects: [{ effect: 'fallback', way: 'open' }] });
    expect(stepDrawerDust(late.next, { type: 'shot', token: 1, shot: shotA })).toEqual({
      next: null,
      effects: [{ effect: 'dispose', shot: shotA }],
    });
  });

  test('the deadline no longer matters once the ash is moving', () => {
    const playing = stepDrawerDust(opening(), { type: 'shot', token: 1, shot: shotA }).next;
    expect(stepDrawerDust(playing, { type: 'late', token: 1 })).toEqual({
      next: playing,
      effects: [],
    });
  });

  test('the ash settling shows the sheet; cut short, it leaves the sheet live', () => {
    const playing = stepDrawerDust(opening(), { type: 'shot', token: 1, shot: shotA }).next;
    expect(stepDrawerDust(playing, { type: 'ended', token: 1, finished: true })).toEqual({
      next: null,
      effects: [{ effect: 'settled', way: 'open' }],
    });
    expect(stepDrawerDust(playing, { type: 'ended', token: 1, finished: false })).toEqual({
      next: null,
      effects: [{ effect: 'abandoned' }],
    });
  });
});

describe('stepDrawerDust: closing', () => {
  test('waits for the canvas to draw before the live sheet is hidden', () => {
    const shotIn = stepDrawerDust(closing(), { type: 'shot', token: 2, shot: shotA });
    expect(shotIn).toEqual({ next: { ...closing(), shot: shotA }, effects: [] });
    const drawn = stepDrawerDust(shotIn.next, { type: 'drawn', token: 2 });
    expect(drawn).toEqual({
      next: { ...closing(), shot: shotA, playing: true },
      effects: [{ effect: 'play', way: 'close' }],
    });
    // A second first-frame report changes nothing.
    expect(stepDrawerDust(drawn.next, { type: 'drawn', token: 2 })).toEqual({
      next: drawn.next,
      effects: [],
    });
  });

  test('a canvas reporting before any photograph is ignored', () => {
    expect(stepDrawerDust(closing(), { type: 'drawn', token: 2 })).toEqual({
      next: closing(),
      effects: [],
    });
  });

  test('a photograph in but a canvas still to draw at the deadline: slide, and drop the picture', () => {
    const shotIn = stepDrawerDust(closing(), { type: 'shot', token: 2, shot: shotA }).next;
    expect(stepDrawerDust(shotIn, { type: 'late', token: 2 })).toEqual({
      next: null,
      effects: [{ effect: 'fallback', way: 'close' }],
    });
  });

  test('the ash settling takes the sheet down', () => {
    const playing = stepDrawerDust(
      stepDrawerDust(closing(), { type: 'shot', token: 2, shot: shotA }).next,
      { type: 'drawn', token: 2 }
    ).next;
    expect(stepDrawerDust(playing, { type: 'ended', token: 2, finished: true })).toEqual({
      next: null,
      effects: [{ effect: 'settled', way: 'close' }],
    });
  });

  test('a reset from outside still ends a close with the sheet down, and an open with it live', () => {
    expect(stepDrawerDust(closing(), { type: 'reset' })).toEqual({
      next: null,
      effects: [{ effect: 'abandoned' }, { effect: 'settled', way: 'close' }],
    });
    expect(stepDrawerDust(opening(), { type: 'reset' })).toEqual({
      next: null,
      effects: [{ effect: 'abandoned' }],
    });
    expect(stepDrawerDust(null, { type: 'reset' })).toEqual({ next: null, effects: [] });
  });
});

describe('stepDrawerDust: tokens', () => {
  test('a finger abandons whatever plays; nothing else happens for a transition that has gone', () => {
    const playing = stepDrawerDust(opening(), { type: 'shot', token: 1, shot: shotA }).next;
    expect(stepDrawerDust(playing, { type: 'abandon' })).toEqual({
      next: null,
      effects: [{ effect: 'abandoned' }],
    });
    expect(stepDrawerDust(null, { type: 'abandon' })).toEqual({ next: null, effects: [] });
    expect(stepDrawerDust(null, { type: 'ended', token: 1, finished: false })).toEqual({
      next: null,
      effects: [],
    });
  });

  test('an event for an older transition leaves the live one alone', () => {
    const live = closing();
    expect(stepDrawerDust(live, { type: 'shot', token: 1, shot: shotA })).toEqual({
      next: live,
      effects: [{ effect: 'dispose', shot: shotA }],
    });
    expect(stepDrawerDust(live, { type: 'late', token: 1 })).toEqual({ next: live, effects: [] });
    expect(stepDrawerDust(live, { type: 'ended', token: 1, finished: true })).toEqual({
      next: live,
      effects: [],
    });
  });

  test('a second photograph for the same transition is disposed, the first kept', () => {
    const shotIn = stepDrawerDust(closing(), { type: 'shot', token: 2, shot: shotA }).next;
    expect(stepDrawerDust(shotIn, { type: 'shot', token: 2, shot: shotB })).toEqual({
      next: shotIn,
      effects: [{ effect: 'dispose', shot: shotB }],
    });
  });
});
