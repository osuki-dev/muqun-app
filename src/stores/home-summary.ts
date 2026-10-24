import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import {
  applyHomeFrame,
  applyHomeOverview,
  type HomeOverviewFrame,
  type HomeOverviewState,
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
  overviews: Record<string, HomeOverviewState>;
  acceptOverview: (frame: HomeOverviewFrame) => void;
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
  overviews: {},
  live: {},
  collectorId: null,
  keepOnly: (serverIds) =>
    set((state) => ({
      overviews: Object.fromEntries(
        Object.entries(state.overviews).filter(([id]) => serverIds.includes(id))
      ),
      summaries: Object.fromEntries(
        Object.entries(state.summaries).filter(([id]) => serverIds.includes(id))
      ),
      live: Object.fromEntries(Object.entries(state.live).filter(([id]) => serverIds.includes(id))),
    })),
  configure: (config) => {
    disk?.set('config', JSON.stringify(config));
    set({ config, live: {}, overviews: {}, collectorId: null });
  },
  acceptOverview: (frame) => {
    const previous = get().overviews[frame.sourceId];
    const next = applyHomeOverview(previous, frame, Date.now());
    if (next === previous) return;
    set((state) => ({
      overviews: next
        ? { ...state.overviews, [frame.sourceId]: next }
        : Object.fromEntries(
            Object.entries(state.overviews).filter(([id]) => id !== frame.sourceId)
          ),
    }));
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
          ? {
              live: { ...state.live, [serverId]: false },
              overviews: Object.fromEntries(
                Object.entries(state.overviews).filter(([id]) => id !== serverId)
              ),
            }
          : state
        : { live: {}, overviews: {}, collectorId: null }
    ),
}));
