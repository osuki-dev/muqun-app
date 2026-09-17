import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentBackgroundTray } from '@/components/agent-background-tray';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * The background tasks route: which workspace to list shells for, and nothing
 * else. The shells are fetched by the tray, the way the diff sheet fetches its
 * own patches.
 */
export default function AgentShellsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ directory?: string }>();
  const bridgeDirectory = useAgentSheetBridge((state) => state.activeDirectory);

  const directory = params.directory || bridgeDirectory;

  return (
    <AgentBackgroundTray {...(directory ? { directory } : {})} onClose={() => router.back()} />
  );
}
