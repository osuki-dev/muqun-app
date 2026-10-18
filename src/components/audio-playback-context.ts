import { createContext } from 'react';
import type { AudioPlaybackPool } from '@/lib/audio-playback-pool';

export const AudioPlaybackContext = createContext<{
  pool: AudioPlaybackPool;
  namespace: string;
  row: string;
} | null>(null);
