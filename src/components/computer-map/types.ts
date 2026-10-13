import type { ConnectionMap } from '@/lib/computer-connection-map';
import type { ConnectionStatus } from '@/lib/server-reachability';

export interface MapPose {
  yaw: number;
  pitch: number;
  distance: number;
}
export const DEFAULT_MAP_POSE: MapPose = { yaw: 0.3, pitch: 0.8, distance: 13 };
export interface ComputerMapSceneProps {
  graph: ConnectionMap;
  selectedId: string;
  pose: MapPose;
  colors: Record<ConnectionStatus, string> & {
    background: string;
    foreground: string;
    accent: string;
  };
  onSelect: (id: string) => void;
  onPose: (pose: MapPose) => void;
  onError: () => void;
}
