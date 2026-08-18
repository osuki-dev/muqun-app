/**
 * An approval clears the dock down to itself -- and the two things that rule
 * must never do: hide the way out, or clear the dock for a question that has no
 * answers on it.
 */
import { describe, expect, test } from 'bun:test';

import { dockPresentation, type DockPresentationInput } from '@/lib/dock-presentation';
import type { PaneApproval } from '@/lib/pane-approval';

const APPROVAL: PaneApproval = {
  fingerprint: 'fp-1',
  prompt: 'Allow npm install?',
  tool: 'Bash',
  context: ['npm install left-pad'],
  hint: 'esc to cancel',
  options: [
    { index: 1, label: 'Yes', selected: true, decision: 'allow' },
    { index: 2, label: 'No', selected: false, decision: 'deny' },
  ],
};

/** What a bad parse leaves behind: a question with nothing to press. */
const OPTIONLESS: PaneApproval = { ...APPROVAL, options: [] };

function input(overrides: Partial<DockPresentationInput> = {}): DockPresentationInput {
  return {
    approval: null,
    keyboardMode: false,
    paneCount: 2,
    showTerminalKeyRow: true,
    attachmentsAvailable: true,
    stagedAttachments: 1,
    screenOnTop: true,
    ...overrides,
  };
}

describe('dock presentation', () => {
  test('with no approval the dock is whole', () => {
    const dock = dockPresentation(input());
    expect(dock.approvalOnly).toBe(false);
    expect(dock.keyRow).toBe(true);
    expect(dock.floatingActions).toBe(false);
    expect(dock.attachEntry).toBe(true);
    expect(dock.attachmentStrip).toBe(true);
    expect(dock.paneChips).toBe(true);
    expect(dock.composer).toBe(true);
    expect(dock.bannerEscape).toBe(false);
  });

  test('an approval leaves nothing in the dock but the question', () => {
    const dock = dockPresentation(input({ approval: APPROVAL }));
    expect(dock.approvalOnly).toBe(true);
    expect(dock.keyRow).toBe(false);
    expect(dock.floatingActions).toBe(false);
    expect(dock.attachEntry).toBe(false);
    expect(dock.attachmentStrip).toBe(false);
    expect(dock.paneChips).toBe(false);
    expect(dock.composer).toBe(false);
  });

  test('the on-screen keyboard stands down with everything else', () => {
    const dock = dockPresentation(input({ approval: APPROVAL, keyboardMode: true }));
    expect(dock.virtualKeyboard).toBe(false);
    // ...and is still the dock's own business once the question is gone.
    expect(dockPresentation(input({ keyboardMode: true })).virtualKeyboard).toBe(true);
  });

  test('the escape is never among what is cleared', () => {
    expect(dockPresentation(input({ approval: APPROVAL })).bannerEscape).toBe(true);
    expect(dockPresentation(input({ approval: APPROVAL, keyboardMode: true })).bannerEscape).toBe(
      true
    );
    // A user who switched the key row off gets one too: an approval is exactly
    // when a way out matters most.
    expect(
      dockPresentation(input({ approval: APPROVAL, showTerminalKeyRow: false })).bannerEscape
    ).toBe(true);
    // No approval, no stand-in -- the row is right there.
    expect(dockPresentation(input()).bannerEscape).toBe(false);
  });

  test('a question with no answers is never allowed to clear the dock', () => {
    const dock = dockPresentation(input({ approval: OPTIONLESS }));
    expect(dock.approvalOnly).toBe(false);
    expect(dock.composer).toBe(true);
    expect(dock.keyRow).toBe(true);
    expect(dock.paneChips).toBe(true);
    expect(dock.attachEntry).toBe(true);
    // The row is back, so the row's own esc is the way out and the banner
    // needs no second one.
    expect(dock.bannerEscape).toBe(false);
  });

  test('everything the dock hid comes back when the question does not', () => {
    const before = dockPresentation(input());
    const after = dockPresentation(input({ approval: null }));
    expect(after).toEqual(before);
  });

  test('the ordinary rules still hold underneath', () => {
    expect(dockPresentation(input({ paneCount: 1 })).paneChips).toBe(false);
    expect(dockPresentation(input({ keyboardMode: true })).paneChips).toBe(false);
    expect(dockPresentation(input({ keyboardMode: true })).keyRow).toBe(false);
    expect(dockPresentation(input({ attachmentsAvailable: false })).attachEntry).toBe(false);
    expect(dockPresentation(input({ stagedAttachments: 0 })).attachmentStrip).toBe(false);
  });

  test('switching the key row off moves its entries rather than deleting them', () => {
    const dock = dockPresentation(input({ showTerminalKeyRow: false }));
    expect(dock.keyRow).toBe(false);
    expect(dock.floatingActions).toBe(true);
    // Everything else about the dock is the setting's business not at all.
    expect(dock.composer).toBe(true);
    expect(dock.paneChips).toBe(true);
    expect(dock.attachEntry).toBe(true);
  });

  test('quick actions and files are offered exactly once, or not at all', () => {
    // The two are the same pair in two places, so both at once would be two
    // sets of the same controls and neither would be no way into either.
    for (const showTerminalKeyRow of [true, false]) {
      for (const keyboardMode of [true, false]) {
        for (const approval of [null, APPROVAL, OPTIONLESS]) {
          const dock = dockPresentation(input({ showTerminalKeyRow, keyboardMode, approval }));
          expect(dock.keyRow && dock.floatingActions).toBe(false);
          // The pair stands down only with the rest of the dock: for the app's
          // own keyboard, which replaces the row, and for a question that can
          // be answered, which clears it.
          const stoodDown = dock.virtualKeyboard || dock.approvalOnly;
          expect(dock.keyRow || dock.floatingActions).toBe(!stoodDown);
        }
      }
    }
  });

  // Card #827. Picking a pane on the panels sheet is the one way the dock gains
  // or loses a row while nothing of it is on screen: the sheet is a full-height
  // `formSheet`, so the whole dock is behind it. A row's layout transition
  // started there settles at the frame it began on instead of the one it was
  // travelling to, which left the key row and the composer standing in the pane
  // strip's slot -- the strip has no layout transition, so it alone landed
  // where it belonged, on top of them.
  describe('reflow while the sheet covers the dock', () => {
    test('rows do not animate their reflow while a sheet is over them', () => {
      expect(dockPresentation(input({ screenOnTop: false })).animateReflow).toBe(false);
    });

    test('rows animate their reflow again once the dock is back on top', () => {
      expect(dockPresentation(input({ screenOnTop: true })).animateReflow).toBe(true);
    });

    test('being covered changes only the motion, never what the dock shows', () => {
      // The sheet must not double as a reason to drop a row: coming back to a
      // dock missing its strip would be the same bug wearing the other face.
      for (const approval of [null, APPROVAL, OPTIONLESS]) {
        for (const keyboardMode of [true, false]) {
          for (const paneCount of [1, 3]) {
            const shared = { approval, keyboardMode, paneCount };
            const { animateReflow: _onTop, ...covered } = dockPresentation(
              input({ ...shared, screenOnTop: false })
            );
            const { animateReflow: _covered, ...onTop } = dockPresentation(
              input({ ...shared, screenOnTop: true })
            );
            expect(covered).toEqual(onTop);
          }
        }
      }
    });
  });
});
