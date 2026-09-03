/**
 * The half of "unpairing a gone gateway no longer looks ignored" that lives on
 * screen rather than in the store.
 *
 * The store's side is a timing rule; this side is the promise the control makes
 * while that rule runs. A reader who taps Confirm against a gateway that is no
 * longer there waits seconds for an answer that never comes, and for that whole
 * stretch the only thing telling them the tap landed is this control: a
 * spinner where the trash icon was, a caption that says what is happening, and
 * two buttons that have stopped taking taps.
 *
 * Each of those is a separate prop on a separate element, which is exactly why
 * they are asserted together here -- the failure this guards is not "the
 * spinner is missing", it is "the spinner is there and the Cancel beside it
 * still works", which looks finished in a screenshot and is wrong.
 */
import { describe, expect, test } from 'bun:test';

import { acceptsCancel, acceptsConfirm, unpairView } from '../unpair-action';

const idle = { armed: false, pending: false };
const armed = { armed: true, pending: false };
const working = { armed: true, pending: true };

describe('the unpair control before the second tap', () => {
  test('an unarmed control shows no destructive pair at all', () => {
    expect(unpairView(idle).showArmedPair).toBe(false);
  });

  test('an armed control offers a live Unpair and a live Cancel', () => {
    const view = unpairView(armed);
    expect(view.showArmedPair).toBe(true);
    expect(view.confirm).toEqual({
      disabled: false,
      dimmed: false,
      busy: false,
      icon: 'trash',
      phase: 'idle',
    });
    expect(view.cancel).toEqual({ disabled: false, dimmed: false });
  });

  test('a first tap on an unarmed control cannot start a removal', () => {
    expect(acceptsConfirm(idle)).toBe(false);
  });
});

describe('the unpair control while the gateway is being asked', () => {
  test('the destructive button says what it is doing instead of sitting there', () => {
    const { confirm } = unpairView(working);
    expect(confirm.phase).toBe('working');
    expect(confirm.icon).toBe('spinner');
    // A screen reader must hear "busy", not merely "dimmed": the work is
    // running, it has not been taken away.
    expect(confirm.busy).toBe(true);
  });

  test('both buttons go inert together, not just the one that was tapped', () => {
    const view = unpairView(working);
    expect(view.confirm.disabled).toBe(true);
    expect(view.cancel.disabled).toBe(true);
    // Looking disabled is part of being disabled; a live-looking Cancel beside
    // a spinner is the exact misread this pins.
    expect(view.confirm.dimmed).toBe(true);
    expect(view.cancel.dimmed).toBe(true);
  });

  test('a second confirm tap cannot queue another removal', () => {
    expect(acceptsConfirm(working)).toBe(false);
  });

  test('Cancel cannot disarm a revoke that is already running', () => {
    // The request is already in flight against the gateway; disarming here
    // would only hide it, and the record would still go.
    expect(acceptsCancel(working)).toBe(false);
    expect(acceptsCancel(armed)).toBe(true);
  });

  test('the spinner and the trash icon are never both shown', () => {
    for (const state of [idle, armed, working]) {
      expect(['trash', 'spinner']).toContain(unpairView(state).confirm.icon);
    }
  });
});
