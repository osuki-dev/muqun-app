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

export const useSshConnectPromptStore = create<SshConnectPromptState>((set, get) => ({
  prompt: null,

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
