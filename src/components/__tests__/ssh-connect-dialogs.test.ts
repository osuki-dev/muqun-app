// The two rules this file exists to keep, both of them about behaviour that is
// invisible to every other gate in the repo and was very nearly lost to a
// rebase once already.
//
// 1. The server's sign-in dialog stays usable under Android's soft keyboard.
//    The keyboard covers Cancel and Continue outright -- verified on a Pixel
//    emulator, the buttons sit entirely below the IME -- so the keyboard's own
//    return key has to submit, and a close request while the keyboard is up has
//    to put the keyboard away instead of abandoning the connection, which is
//    what the system back gesture would otherwise do. That is #7. It was
//    written against the copy of the dialog that lived in
//    `ssh-terminal-workspace.tsx`, and #4 moved the dialog to
//    `ssh-host-key-dialog.tsx` from a branch that predated it: the rebase
//    dropped all three parts silently and they were put back by hand.
//
// 2. The two connect dialogs hand over through `useModalHandoff`. iOS presents
//    one modal at a time and refuses one asked for while the previous is still
//    going away -- trusting a host key and then being asked for a one-time code
//    is exactly that pair, and against a server on the same machine both land
//    in one frame. The dialog then renders, invisibly, and the connection waits
//    forever on a question nobody can see.
//
// Neither rule can be checked by types, lint or a render test (this repo has no
// renderer). So the scan reads the real TypeScript AST, scopes itself to each
// exported dialog by name, and fails loudly if a dialog it expects is gone --
// a rename is a finding here, not a silent pass.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const DIALOGS = join(dirname(fileURLToPath(import.meta.url)), '..', 'ssh-host-key-dialog.tsx');

/** The source of one exported function, by name. */
function dialogSource(name: string): string {
  const text = readFileSync(DIALOGS, 'utf8');
  const source = ts.createSourceFile(DIALOGS, text, ts.ScriptTarget.Latest, true);
  let found: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node.getText(source);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found === undefined) {
    throw new Error(`${name} is not an exported function of ssh-host-key-dialog.tsx any more`);
  }
  return found;
}

describe('the server sign-in dialog survives the Android soft keyboard', () => {
  const dialog = dialogSource('SshKeyboardInteractiveDialog');

  test('it knows whether the keyboard is up', () => {
    expect(dialog).toContain("Keyboard.addListener('keyboardDidShow'");
    expect(dialog).toContain("Keyboard.addListener('keyboardDidHide'");
  });

  test('a close request with the keyboard up dismisses the keyboard, not the connection', () => {
    // The order matters: `Keyboard.dismiss()` has to come first and return, so
    // the `onResolve(undefined)` below it is only ever reached with the
    // keyboard already down.
    const dismiss = dialog.indexOf('Keyboard.dismiss()');
    const cancel = dialog.indexOf('onResolve(undefined)');
    expect(dismiss).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(dismiss);
    expect(dialog).toContain('if (keyboardUp)');
  });

  test('the last field submits from the keyboard, since Continue is under it', () => {
    expect(dialog).toContain('returnKeyType');
    expect(dialog).toContain('onSubmitEditing');
    expect(dialog).toContain("index === prompts.length - 1 ? 'go' : 'next'");
  });
});

describe('the connect dialogs hand over one at a time', () => {
  test('both of them wait out the beat before asking to be presented', () => {
    for (const name of ['SshHostKeyDialog', 'SshKeyboardInteractiveDialog']) {
      const dialog = dialogSource(name);
      expect(dialog).toContain('useModalHandoff()');
      expect(dialog).toContain('if (!ready) return null;');
    }
  });
});
