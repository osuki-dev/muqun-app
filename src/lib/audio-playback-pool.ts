import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  AudioPlaybackSession,
  type AudioPlaybackRuntime,
  type AudioPlaybackState,
} from '@/lib/audio-playback-session';

type PreviewState = { playback: AudioPlaybackState; peaks: number[] | null };
export type AudioPlaybackEntry = {
  session: AudioPlaybackSession;
  store: StoreApi<PreviewState>;
};
type RuntimeFactory = (onPeaks: (peaks: number[] | null) => void) => AudioPlaybackRuntime;

export function createAudioPlaybackEntry(runtime: RuntimeFactory): AudioPlaybackEntry {
  const store = createStore<PreviewState>(() => ({
    playback: { phase: 'idle', position: 0, duration: 0 },
    peaks: null,
  }));
  const session = new AudioPlaybackSession(
    runtime((peaks) => store.setState({ peaks })),
    (playback) => store.setState({ playback })
  );
  return { session, store };
}

/** The conversation owns audio; recycled rows only own their controls. */
export class AudioPlaybackPool {
  private entries = new Map<string, Map<string, AudioPlaybackEntry>>();

  acquire(namespace: string, key: string, runtime: RuntimeFactory): AudioPlaybackEntry {
    let entries = this.entries.get(namespace);
    if (!entries) {
      entries = new Map();
      this.entries.set(namespace, entries);
    }
    let entry = entries.get(key);
    if (!entry || entry.store.getState().playback.phase === 'error') {
      entry = createAudioPlaybackEntry(runtime);
      entries.set(key, entry);
    }
    return entry;
  }

  async clear(namespace: string) {
    const entries = this.entries.get(namespace);
    this.entries.delete(namespace);
    await Promise.all(Array.from(entries?.values() ?? [], (entry) => entry.session.close()));
  }
}
