import {
  collectorOrder,
  type Collector,
  type HomeFrame,
  type HomeSource,
  type HomeSummaryConfig,
} from './home-summary';

export interface SummaryConnection {
  close(): void;
}
export interface SummaryControllerOptions {
  pairedIds: readonly string[];
  summaryIds: readonly string[];
  config: HomeSummaryConfig;
  connect: (
    serverId: string,
    sources: readonly HomeSource[],
    receive: (frame: HomeFrame) => void,
    lost: () => void
  ) => SummaryConnection;
  accept: (frame: HomeFrame) => boolean;
  clear: () => void;
  selected: (serverId: string | null) => void;
  schedule: (run: () => void, delayMs: number) => () => void;
}

/** A single owner per mounted Home. Selection epochs fence late callbacks. */
export function startHomeSummary(options: SummaryControllerOptions): () => void {
  let stopped = false;
  let epoch = 0;
  let cancelTimer: (() => void) | undefined;
  let connections: SummaryConnection[] = [];
  const candidates = collectorOrder(options.config, options.pairedIds).filter((candidate) =>
    options.summaryIds.includes(candidate.serverId)
  );
  function clear() {
    epoch++;
    cancelTimer?.();
    cancelTimer = undefined;
    for (const connection of connections) connection.close();
    connections = [];
    options.clear();
  }
  function attempt(index: number) {
    if (stopped) return;
    clear();
    const turn = epoch;
    const candidate: Collector | undefined = candidates[index];
    if (!candidate) {
      options.selected(null);
      // Direct mode, including a single computer: no peers and no election timer.
      for (const serverId of options.summaryIds) {
        connections.push(
          options.connect(
            serverId,
            [],
            (frame) => {
              if (
                !stopped &&
                epoch === turn &&
                frame.sourceId === serverId &&
                !options.accept(frame)
              ) {
                options.accept({ t: 'home_status', sourceId: serverId, status: 'unavailable' });
                cancelTimer?.();
                cancelTimer = options.schedule(() => attempt(index), 0);
              }
            },
            () => {
              if (!stopped && epoch === turn)
                options.accept({ t: 'home_status', sourceId: serverId, status: 'unavailable' });
            }
          )
        );
      }
      if (candidates.length) cancelTimer = options.schedule(() => attempt(0), 30_000);
      return;
    }
    const sources = Object.entries(candidate.sources).filter(([id]) =>
      options.pairedIds.includes(id)
    );
    const allowed = new Set([candidate.serverId, ...sources.map(([id]) => id)]);
    const ready = new Set<string>();
    let failed = false;
    const next = () => {
      if (stopped || epoch !== turn || failed) return;
      failed = true;
      // A callback can fire synchronously during connect; defer cleanup until its lease exists.
      cancelTimer?.();
      cancelTimer = options.schedule(() => attempt(index + 1), 0);
    };
    cancelTimer = options.schedule(next, 8_000);
    connections.push(
      options.connect(
        candidate.serverId,
        sources.map(([, source]) => source),
        (frame) => {
          if (stopped || failed || epoch !== turn || !allowed.has(frame.sourceId)) return;
          if (!options.accept(frame)) {
            next();
            return;
          }
          if (frame.t === 'home_status') ready.delete(frame.sourceId);
          if (frame.t === 'home' && frame.snapshot) ready.add(frame.sourceId);
          if (ready.has(candidate.serverId) && (sources.length === 0 || ready.size > 1)) {
            cancelTimer?.();
            cancelTimer = undefined;
            options.selected(candidate.serverId);
          }
        },
        next
      )
    );
  }
  attempt(0);
  return () => {
    stopped = true;
    clear();
    options.selected(null);
  };
}
