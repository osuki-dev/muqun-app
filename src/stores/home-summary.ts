import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import {
  applyHomeFrame,
  NO_HOME_SUMMARY,
  parseHomeSummaryConfig,
  type HomeSummary,
  type HomeSummaryConfig,
  type HomeSummaryFrame,
} from '@/lib/home-summary';

function storage() {
  try {
    return createMMKV({ id: 'muqun.home-summary' });
  } catch {
    return null;
  }
}
const disk = storage();
function initial(): HomeSummaryConfig {
  try {
    return parseHomeSummaryConfig(JSON.parse(disk?.getString('config') ?? 'null'));
  } catch {
    return NO_HOME_SUMMARY;
  }
}

type State = {
  config: HomeSummaryConfig;
  summaries: Record<string, HomeSummary>;
  live: Record<string, boolean>;
  collectorId: string | null;
  configure: (config: HomeSummaryConfig) => void;
  accept: (frame: HomeSummaryFrame) => boolean;
  disconnected: (serverId?: string) => void;
  keepOnly: (serverIds: readonly string[]) => void;
};
export const useHomeSummary = create<State>((set, get) => ({
  config: initial(),
  summaries: {},
  live: {},
  collectorId: null,
  keepOnly: (serverIds) =>
    set((state) => ({
      summaries: Object.fromEntries(
        Object.entries(state.summaries).filter(([id]) => serverIds.includes(id))
      ),
      live: Object.fromEntries(Object.entries(state.live).filter(([id]) => serverIds.includes(id))),
    })),
  configure: (config) => {
    disk?.set('config', JSON.stringify(config));
    set({ config, live: {}, collectorId: null });
  },
  accept: (frame) => {
    const previous = get().summaries[frame.sourceId];
    const next = applyHomeFrame(previous, frame, Date.now());
    if (!next) return false;
    set((state) => ({
      summaries:
        next === previous ? state.summaries : { ...state.summaries, [frame.sourceId]: next },
      live: state.live[frame.sourceId] ? state.live : { ...state.live, [frame.sourceId]: true },
    }));
    return true;
  },
  disconnected: (serverId) =>
    set((state) =>
      serverId
        ? state.live[serverId]
          ? { live: { ...state.live, [serverId]: false } }
          : state
        : { live: {}, collectorId: null }
    ),
}));
