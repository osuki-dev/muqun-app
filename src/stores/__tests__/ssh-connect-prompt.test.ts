// Which mounted gate draws the SSH connect prompt.
//
// This is not a preference. The gate near the navigation root cannot draw a
// dialog over an Expo Router screen presented as a native `modal` on iOS: the
// dialog is a React Native `<Modal>`, and UIKit will not present a second view
// controller from one that is already presenting. Pairing through an SSH host
// asks its host-key question from inside exactly such a modal, and before this
// the prompt was set, the root gate rendered, and nothing appeared -- the
// screen sat on "Opening tunnel" forever, waiting on a dialog nobody could see.
// So the modal mounts its own gate, and the last one mounted is the one that
// draws.
import { beforeEach, describe, expect, test } from 'bun:test';

import { useSshConnectPromptStore } from '../ssh-connect-prompt';

const KEY = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:aaa', publicKey: 'AAAAC3Nz' };

beforeEach(() => {
  useSshConnectPromptStore.setState({ prompt: null, gates: [] });
});

describe('which gate draws', () => {
  test('the only mounted gate draws', () => {
    const { id } = useSshConnectPromptStore.getState().registerPromptGate();
    expect(useSshConnectPromptStore.getState().isActiveGate(id)).toBe(true);
  });

  test('the gate mounted last wins, so a modal beats the root', () => {
    const root = useSshConnectPromptStore.getState().registerPromptGate();
    const modal = useSshConnectPromptStore.getState().registerPromptGate();
    expect(useSshConnectPromptStore.getState().isActiveGate(root.id)).toBe(false);
    expect(useSshConnectPromptStore.getState().isActiveGate(modal.id)).toBe(true);
  });

  test('the root takes over again once the modal unmounts', () => {
    const root = useSshConnectPromptStore.getState().registerPromptGate();
    const modal = useSshConnectPromptStore.getState().registerPromptGate();
    modal.unregister();
    expect(useSshConnectPromptStore.getState().isActiveGate(root.id)).toBe(true);
  });

  test('an unmounted gate never draws', () => {
    const root = useSshConnectPromptStore.getState().registerPromptGate();
    root.unregister();
    expect(useSshConnectPromptStore.getState().isActiveGate(root.id)).toBe(false);
  });
});

describe('asking, and never leaving a connection hanging', () => {
  test('a host-key answer resolves the promise the connect is waiting on', async () => {
    const asked = useSshConnectPromptStore.getState().askHostKey('h.example', 'unknown', KEY);
    const prompt = useSshConnectPromptStore.getState().prompt;
    expect(prompt?.kind).toBe('hostKey');
    prompt?.resolve(true as never);
    expect(await asked).toBe(true);
    expect(useSshConnectPromptStore.getState().prompt).toBeNull();
  });

  test('an abandoned prompt is dismissed with the declining answer', async () => {
    const asked = useSshConnectPromptStore.getState().askHostKey('h.example', 'mismatch', KEY);
    useSshConnectPromptStore.getState().dismiss();
    // A mismatch is never accepted by default -- declining is the safe answer,
    // and the connect attempt must not be left waiting forever either.
    expect(await asked).toBe(false);
  });

  test('a second ask declines the first rather than stacking dialogs', async () => {
    const first = useSshConnectPromptStore.getState().askHostKey('a.example', 'unknown', KEY);
    useSshConnectPromptStore.getState().askHostKey('b.example', 'unknown', KEY);
    expect(await first).toBe(false);
    const current = useSshConnectPromptStore.getState().prompt;
    expect(current?.kind === 'hostKey' ? current.host : null).toBe('b.example');
  });
});
