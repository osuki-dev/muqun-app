import { useLocalSearchParams } from 'expo-router';

import { SshTerminalWorkspace } from '@/components/ssh-terminal-workspace';

/** One SSH host's shell. The route is only the id; the screen does the rest. */
export default function SshHostScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  return <SshTerminalWorkspace hostId={typeof hostId === 'string' ? hostId : ''} />;
}
