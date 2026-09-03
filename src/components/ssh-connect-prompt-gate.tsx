import { useEffect, useState } from 'react';

import { SshHostKeyDialog, SshKeyboardInteractiveDialog } from '@/components/ssh-host-key-dialog';
import { useSshConnectPromptStore } from '@/stores/ssh-connect-prompt';

/**
 * Renders the one pending SSH connect prompt, if any, over the whole app.
 * Mounted once near the navigation root so a tunnel opening in the background
 * can still ask the reader about a host key or a keyboard-interactive
 * challenge. See `stores/ssh-connect-prompt.ts`.
 *
 * A screen presented as a native `modal` mounts a **second** one of these. Only
 * the last gate mounted draws, so the copy inside the modal wins while it is up
 * -- see `registerPromptGate` for why the root copy cannot draw over it on iOS.
 */
export function SshConnectPromptGate() {
  const prompt = useSshConnectPromptStore((state) => state.prompt);
  const register = useSshConnectPromptStore((state) => state.registerPromptGate);
  const [id, setId] = useState<number | null>(null);
  const active = useSshConnectPromptStore((state) =>
    id === null ? false : state.isActiveGate(id)
  );

  useEffect(() => {
    const registration = register();
    setId(registration.id);
    return registration.unregister;
  }, [register]);

  if (!prompt || !active) return null;
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
