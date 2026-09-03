import { create } from 'zustand';

import type { SshKeyboardInteractiveChallenge } from '@/lib/ssh-client';
import type { SshTrustedHostKey } from '@/lib/ssh-hosts';

/**
 * The app-wide asking gate for an SSH connection that has no screen of its own
 * -- the gateway tunnel opens in the background, but a new or changed host key
 * is a decision only the reader may make, and a keyboard-interactive host asks
 * its own questions. Both are surfaced through this store and drawn by
 * `SshConnectPromptGate`, using the very same dialogs the terminal screen uses
 * (`components/ssh-host-key-dialog.tsx`). The terminal screen keeps its own
 * inline prompt state because it is already a conversation on one screen; this
 * exists for connections that are not.
 *
 * One prompt at a time, resolved by the dialog. A prompt whose connection is
 * abandoned is dismissed with the declining answer, so no attempt is left
 * waiting on a dialog nobody will answer.
 */
export type SshConnectPrompt =
  | {
      kind: 'hostKey';
      host: string;
      verdict: 'unknown' | 'mismatch';
      presented: SshTrustedHostKey;
      trusted?: SshTrustedHostKey;
      resolve: (accept: boolean) => void;
    }
  | {
      kind: 'keyboardInteractive';
      challenge: SshKeyboardInteractiveChallenge;
      resolve: (answers: string[] | undefined) => void;
    };

interface SshConnectPromptState {
  prompt: SshConnectPrompt | null;
  /**
   * Mounted gates, innermost last. See {@link registerPromptGate}.
   */
  gates: number[];
  /**
   * Mount a gate and get back its id and the matching unmount. Only the
   * last-registered gate draws the prompt.
   *
   * This exists because of an iOS presentation rule rather than a preference.
   * The gate near the navigation root cannot draw over an Expo Router screen
   * presented as a native `modal` -- the dialog is a React Native `<Modal>`,
   * which presents a view controller from the root, and UIKit will not present
   * from a controller that is already presenting one. The prompt was set, the
   * gate rendered, and nothing appeared: pairing through an SSH host sat on
   * "Opening tunnel" forever, because the host-key question it was waiting on
   * had been asked into a window nobody could see. A screen presented as a
   * modal therefore mounts its own gate, and being mounted later, it wins.
   */
  registerPromptGate: () => { id: number; unregister: () => void };
  /** Whether this gate is the one that should draw. */
  isActiveGate: (id: number) => boolean;
  askHostKey: (
    host: string,
    verdict: 'unknown' | 'mismatch',
    presented: SshTrustedHostKey,
    trusted?: SshTrustedHostKey
  ) => Promise<boolean>;
  askKeyboardInteractive: (
    challenge: SshKeyboardInteractiveChallenge
  ) => Promise<string[] | undefined>;
  /** Close whatever is up with its declining answer (connection abandoned). */
  dismiss: () => void;
}

let nextGateId = 1;

export const useSshConnectPromptStore = create<SshConnectPromptState>((set, get) => ({
  prompt: null,
  gates: [],

  registerPromptGate() {
    const id = nextGateId++;
    set((state) => ({ gates: [...state.gates, id] }));
    return {
      id,
      unregister: () => set((state) => ({ gates: state.gates.filter((item) => item !== id) })),
    };
  },

  isActiveGate(id) {
    const { gates } = get();
    return gates.length > 0 && gates[gates.length - 1] === id;
  },

  askHostKey(host, verdict, presented, trusted) {
    // A second connect while a prompt is up declines the earlier one rather
    // than stacking; connections are opened one at a time in practice.
    get().dismiss();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const once = (accept: boolean) => {
        if (settled) return;
        settled = true;
        set((state) => (state.prompt?.resolve === once ? { prompt: null } : {}));
        resolve(accept);
      };
      set({ prompt: { kind: 'hostKey', host, verdict, presented, trusted, resolve: once } });
    });
  },

  askKeyboardInteractive(challenge) {
    get().dismiss();
    return new Promise<string[] | undefined>((resolve) => {
      let settled = false;
      const once = (answers: string[] | undefined) => {
        if (settled) return;
        settled = true;
        set((state) => (state.prompt?.resolve === once ? { prompt: null } : {}));
        resolve(answers);
      };
      set({ prompt: { kind: 'keyboardInteractive', challenge, resolve: once } });
    });
  },

  dismiss() {
    const current = get().prompt;
    if (!current) return;
    set({ prompt: null });
    if (current.kind === 'hostKey') current.resolve(false);
    else current.resolve(undefined);
  },
}));
