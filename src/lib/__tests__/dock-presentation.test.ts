/**
 * An approval clears the dock down to itself -- and the two things that rule
 * must never do: hide the way out, or clear the dock for a question that has no
 * answers on it.
 */
import { describe, expect, test } from 'bun:test';

import {
  dockPresentation,
  latestPillVisible,
  type DockPresentationInput,
} from '@/lib/dock-presentation';
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
    editorPane: false,
    composerRevealed: false,
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

  // An editor is driven a keystroke at a time, so on those panes the keyboard
  // is the input and the composer is a line buffer taking up the height the
  // file wanted. It stands down -- and only there, and only behind a way back.
  describe('an editor pane behind the keyboard', () => {
    const editing = { keyboardMode: true, editorPane: true };

    test('stands the composer down and leaves a way back to it', () => {
      const dock = dockPresentation(input(editing));
      expect(dock.composer).toBe(false);
      expect(dock.composerEntry).toBe(true);
    });

    test('keeps the keys reachable by moving them into the keyboard', () => {
      // The defect this replaces: opening the keyboard hid the row carrying
      // esc, `:w` and the Ctrl chords, so typing and reaching for them were
      // mutually exclusive on the one pane that wants both.
      const dock = dockPresentation(input(editing));
      expect(dock.virtualKeyboard).toBe(true);
      expect(dock.keyRow).toBe(false);
      expect(dock.keysInKeyboard).toBe(true);
    });

    test('gives the composer back when it is asked for', () => {
      const dock = dockPresentation(input({ ...editing, composerRevealed: true }));
      expect(dock.composer).toBe(true);
      expect(dock.composerEntry).toBe(false);
    });

    test('a reader who switched the row off does not get it back in the keyboard', () => {
      const dock = dockPresentation(input({ ...editing, showTerminalKeyRow: false }));
      expect(dock.keysInKeyboard).toBe(false);
    });

    test('the composer stands down behind the keyboard on any pane', () => {
      // Not an editor-only rule: a full QWERTY and a line buffer are two inputs
      // arguing whatever the pane runs. This is what the screen already did by
      // nesting the composer inside the keyboard's else-branch; naming it is
      // what let a way back exist.
      const shell = dockPresentation(input({ keyboardMode: true }));
      expect(shell.composer).toBe(false);
      expect(shell.composerEntry).toBe(true);
    });

    test('a shell with the keyboard closed keeps its composer and grows no button', () => {
      const dock = dockPresentation(input({ editorPane: false }));
      expect(dock.composer).toBe(true);
      expect(dock.composerEntry).toBe(false);
    });

    test('an approval still clears the dock, editor or not', () => {
      const dock = dockPresentation(input({ ...editing, approval: APPROVAL }));
      expect(dock.approvalOnly).toBe(true);
      expect(dock.composer).toBe(false);
      expect(dock.composerEntry).toBe(false);
      expect(dock.keysInKeyboard).toBe(false);
    });
  });

  // The 2.0 rule. An editor is not a pane with a different dock on it -- it is
  // a pane with no dock at all, and a cluster floating over the grid in the
  // dock's place. Everything here is about what leaves and what is allowed to
  // come back.
  describe('an editor takes the whole pane', () => {
    /** Arriving on nvim: the cluster is collapsed, so `keyboardMode` is off. */
    const arrived = { editorPane: true, keyboardMode: false };
    /** The handle tapped: the cluster is open. */
    const opened = { editorPane: true, keyboardMode: true };

    test('arriving leaves the handle and nothing else', () => {
      const dock = dockPresentation(input(arrived));
      expect(dock.editorMode).toBe(true);
      expect(dock.editorHandle).toBe(true);
      expect(dock.editorPanel).toBe(false);
      // Every row the dock would otherwise have. A pane strip, a key row, a
      // paperclip or a staged-file tile on screen is a dock, whatever it is
      // called, and the height it takes is the height nvim wanted.
      expect(dock.keyRow).toBe(false);
      expect(dock.floatingActions).toBe(false);
      expect(dock.paneChips).toBe(false);
      expect(dock.attachEntry).toBe(false);
      expect(dock.attachmentStrip).toBe(false);
      expect(dock.composer).toBe(false);
      expect(dock.virtualKeyboard).toBe(false);
      // Not even the "write a line" button: the handle is already that door,
      // and two floating circles for one destination is one too many.
      expect(dock.composerEntry).toBe(false);
    });

    test('the setting that hides the key row cannot put a row back', () => {
      // `floatingActions` is the key row's understudy, and an editor has no
      // stage for either of them.
      for (const showTerminalKeyRow of [true, false]) {
        const dock = dockPresentation(input({ ...arrived, showTerminalKeyRow }));
        expect(dock.keyRow).toBe(false);
        expect(dock.floatingActions).toBe(false);
      }
    });

    test('a second pane does not bring the strip back either', () => {
      expect(dockPresentation(input({ ...arrived, paneCount: 4 })).paneChips).toBe(false);
    });

    test('opening the cluster is the keyboard, and the keys ride in it', () => {
      const dock = dockPresentation(input(opened));
      expect(dock.editorPanel).toBe(true);
      expect(dock.editorHandle).toBe(false);
      expect(dock.virtualKeyboard).toBe(true);
      expect(dock.keysInKeyboard).toBe(true);
      // Still no dock underneath it -- the panel floats, it does not restore.
      expect(dock.keyRow).toBe(false);
      expect(dock.paneChips).toBe(false);
    });

    test('the composer is reachable from the open cluster and only from there', () => {
      const shut = dockPresentation(input(arrived));
      expect(shut.composerEntry).toBe(false);
      const open = dockPresentation(input(opened));
      expect(open.composerEntry).toBe(true);
      expect(open.composer).toBe(false);
      const asked = dockPresentation(input({ ...opened, composerRevealed: true }));
      expect(asked.composer).toBe(true);
      expect(asked.composerEntry).toBe(false);
      // The panel is still the panel with a text field in it, and the keys are
      // still on it -- which is the whole point. They move out of the QWERTY
      // and onto a row of their own, because the QWERTY leaves: the phone's own
      // keyboard is now up for the field.
      expect(asked.editorPanel).toBe(true);
      expect(asked.virtualKeyboard).toBe(false);
      expect(asked.keysInKeyboard).toBe(false);
      expect(asked.keyRow).toBe(true);
    });

    test('the keys never leave the panel, whichever surface is carrying them', () => {
      // The defect the key row inside the keyboard was added for, restated for
      // the panel: whatever the reader is doing on an editor, `esc`, `:w` and
      // the Ctrl chords are one tap away. Exactly one surface carries them, so
      // there is never a second row of the same keys either.
      for (const composerRevealed of [true, false]) {
        const dock = dockPresentation(input({ ...opened, composerRevealed }));
        expect(dock.keysInKeyboard || dock.keyRow).toBe(true);
        expect(dock.keysInKeyboard && dock.keyRow).toBe(false);
      }
      // ...unless the reader switched the key row off, in which case they are
      // nowhere, on this pane as on every other.
      for (const composerRevealed of [true, false]) {
        const dock = dockPresentation(
          input({ ...opened, composerRevealed, showTerminalKeyRow: false })
        );
        expect(dock.keysInKeyboard).toBe(false);
        expect(dock.keyRow).toBe(false);
      }
    });

    test('the app never shows two keyboards at once inside the panel', () => {
      const dock = dockPresentation(input({ ...opened, composerRevealed: true }));
      expect(dock.composer).toBe(true);
      expect(dock.virtualKeyboard).toBe(false);
    });

    test('the handle and the panel are one control and never two', () => {
      for (const keyboardMode of [true, false]) {
        for (const composerRevealed of [true, false]) {
          const dock = dockPresentation(
            input({ editorPane: true, keyboardMode, composerRevealed })
          );
          expect(dock.editorHandle && dock.editorPanel).toBe(false);
          expect(dock.editorHandle || dock.editorPanel).toBe(true);
        }
      }
    });

    test('a standing question outranks the editor and takes the pane back', () => {
      const dock = dockPresentation(input({ ...opened, approval: APPROVAL }));
      expect(dock.editorMode).toBe(false);
      expect(dock.editorHandle).toBe(false);
      expect(dock.editorPanel).toBe(false);
      expect(dock.approvalOnly).toBe(true);
      // And the way out of the question is still on the banner, because
      // neither the row nor the keyboard is there to carry it.
      expect(dock.bannerEscape).toBe(true);
    });

    test('a question with no answers leaves the editor whole', () => {
      // The degenerate parse never clears anything, and it must not clear the
      // editor into a dock either.
      const dock = dockPresentation(input({ ...arrived, approval: OPTIONLESS }));
      expect(dock.editorMode).toBe(true);
      expect(dock.editorHandle).toBe(true);
      expect(dock.keyRow).toBe(false);
    });

    test('leaving the editor gives the ordinary dock back exactly', () => {
      // nvim exits: `editorPane` goes false and nothing else about the screen
      // changed. The dock that comes back is the dock that would have been
      // there all along.
      const editing = dockPresentation(input({ editorPane: true, keyboardMode: false }));
      expect(editing.editorMode).toBe(true);
      const after = dockPresentation(input({ editorPane: false, keyboardMode: false }));
      expect(after).toEqual(dockPresentation(input()));
      expect(after.editorMode).toBe(false);
      expect(after.keyRow).toBe(true);
      expect(after.composer).toBe(true);
      expect(after.paneChips).toBe(true);
    });

    test('a shell pane is never in editor mode, whatever else is true', () => {
      for (const keyboardMode of [true, false]) {
        for (const composerRevealed of [true, false]) {
          const dock = dockPresentation(
            input({ editorPane: false, keyboardMode, composerRevealed })
          );
          expect(dock.editorMode).toBe(false);
          expect(dock.editorHandle).toBe(false);
          expect(dock.editorPanel).toBe(false);
        }
      }
    });
  });
  // One circle does not get a line of the pane. The entry had a row to itself,
  // which is the same rent `floatingActions` refuses -- and it was charging it
  // out of the height the keyboard had just been opened to get.
  describe('the way back to the composer rides in a row that already exists', () => {
    test('with the keys up, the entry rides in their row', () => {
      const dock = dockPresentation(input({ keyboardMode: true }));
      expect(dock.keysInKeyboard).toBe(true);
      expect(dock.composerEntry).toBe(true);
      expect(dock.composer).toBe(false);
    });

    test('with the key row switched off there is no seat, so the field shows instead', () => {
      // The alternative is a row grown to hold one button, which costs exactly
      // what taking the button's row away just saved. So this state shows the
      // destination rather than the door to it.
      const dock = dockPresentation(input({ keyboardMode: true, showTerminalKeyRow: false }));
      expect(dock.keysInKeyboard).toBe(false);
      expect(dock.composerEntry).toBe(false);
      expect(dock.composer).toBe(true);
    });

    test('the entry is never on screen without a row under it', () => {
      // The whole rule, over every combination the screen can be in: if the
      // button is showing, the keys' row is showing, because that is where it
      // sits.
      for (const keyboardMode of [true, false]) {
        for (const editorPane of [true, false]) {
          for (const composerRevealed of [true, false]) {
            for (const showTerminalKeyRow of [true, false]) {
              const dock = dockPresentation(
                input({ keyboardMode, editorPane, composerRevealed, showTerminalKeyRow })
              );
              if (dock.composerEntry) expect(dock.keysInKeyboard).toBe(true);
              // And there is always exactly one of the two: a way to the
              // composer, or the composer -- never neither, unless the pane has
              // nothing on it at all.
              if (!dock.approvalOnly && !dock.editorHandle) {
                expect(dock.composer || dock.composerEntry).toBe(true);
              }
              expect(dock.composer && dock.composerEntry).toBe(false);
            }
          }
        }
      }
    });

    test('the same rule on an editor, where there is no dock to fall back on', () => {
      const open = { editorPane: true, keyboardMode: true };
      expect(dockPresentation(input(open)).composerEntry).toBe(true);
      const noKeys = dockPresentation(input({ ...open, showTerminalKeyRow: false }));
      expect(noKeys.composerEntry).toBe(false);
      expect(noKeys.composer).toBe(true);
    });
  });
});

// The pill is a way back to the bottom of a scrollback. It is a function
// rather than a condition in a render because the third of its three clauses
// is a statement about the app -- what "latest" means on a pane whose program
// paints the whole viewport -- and a statement about the app should be
// somewhere a test can read it.
describe('the jump-to-latest pill', () => {
  const scrolled = { following: false, selecting: false, ownsScreen: false };

  test('offered to a reader who has left the tail', () => {
    expect(latestPillVisible(scrolled)).toBe(true);
  });

  test('not offered to one who is already on it', () => {
    expect(latestPillVisible({ ...scrolled, following: true })).toBe(false);
  });

  test('not offered under a selection, which has the seat', () => {
    expect(latestPillVisible({ ...scrolled, selecting: true })).toBe(false);
  });

  test('never on a pane whose program owns the screen', () => {
    // nvim repaints its own viewport and keeps nothing behind it, so there is
    // no "latest" to jump to -- and the offer was being made in the corner of
    // a file, over a surface whose author has an opinion about every cell.
    expect(latestPillVisible({ ...scrolled, ownsScreen: true })).toBe(false);
  });

  test('and not even when every other reason to show it holds', () => {
    for (const following of [true, false]) {
      for (const selecting of [true, false]) {
        expect(latestPillVisible({ following, selecting, ownsScreen: true })).toBe(false);
      }
    }
  });
});
