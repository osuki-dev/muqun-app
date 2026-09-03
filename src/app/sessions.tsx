import { useLocalSearchParams, useRouter } from 'expo-router';

import { SessionSwitcherSheet } from '@/components/session-switcher-sheet';
import { parseSessionChoices } from '@/lib/session-switcher';
import { useServerSession } from '@/stores/server-session';

/**
 * The session switcher's route: its params, and the one thing only a route can
 * do -- hand the pick back through the store, because a sheet cannot return a
 * value without pushing another copy of the workspace. The panels sheet next
 * door works exactly this way.
 *
 * The sheet's own frame belongs to `SessionSwitcherSheet`, so the route adds no
 * layout of its own; a wrapper here would break the native form sheet's
 * two-subview rule.
 */
export default function SessionSwitcherScreen() {
  const router = useRouter();
  const chooseSession = useServerSession((state) => state.chooseSession);
  const params = useLocalSearchParams<{
    serverId: string;
    sessionId: string;
    sessions?: string;
  }>();

  return (
    <SessionSwitcherSheet
      sessions={parseSessionChoices(params.sessions)}
      sessionId={params.sessionId || ''}
      onChoose={(sessionId) => chooseSession({ serverId: params.serverId, sessionId })}
      onClose={() => router.back()}
    />
  );
}
