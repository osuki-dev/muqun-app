import { SshHostKeyDialog, SshKeyboardInteractiveDialog } from '@/components/ssh-host-key-dialog';
import { useSshConnectPromptStore } from '@/stores/ssh-connect-prompt';

/**
 * Renders the one pending SSH connect prompt, if any, over the whole app.
 * Mounted once near the navigation root so a tunnel opening in the background
 * can still ask the reader about a host key or a keyboard-interactive
 * challenge. See `stores/ssh-connect-prompt.ts`.
 */
export function SshConnectPromptGate() {
  const prompt = useSshConnectPromptStore((state) => state.prompt);
  if (!prompt) return null;
  if (prompt.kind === 'hostKey') {
    return (
      <SshHostKeyDialog
        verdict={prompt.verdict}
        presented={prompt.presented}
        trusted={prompt.trusted}
        host={prompt.host}
        onResolve={prompt.resolve}
      />
    );
  }
  return <SshKeyboardInteractiveDialog challenge={prompt.challenge} onResolve={prompt.resolve} />;
}
