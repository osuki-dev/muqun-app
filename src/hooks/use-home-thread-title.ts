import { homeThreadKey, homeThreadTitle, type HomeThreadTarget } from '@/lib/home-thread';
import { useHomeThreadLive } from '@/stores/home-thread';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import { useShallow } from 'zustand/react/shallow';

/** Both reply surfaces read the same identity-scoped, freshest title. */
export function useHomeThreadTitle(target: HomeThreadTarget | undefined) {
  const key = target ? homeThreadKey(target) : null;
  const live = useHomeThreadLive(
    useShallow((state) =>
      key && state.key === key
        ? { title: state.live.title, titleUpdatedMs: state.live.titleUpdatedMs }
        : undefined
    )
  );
  const listing = useHomeAgentSessions((state) =>
    target ? state.byServer[target.serverId] : undefined
  );
  return homeThreadTitle(target, live, listing);
}
