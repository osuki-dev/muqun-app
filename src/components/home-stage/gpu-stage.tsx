// Web has no WebGPU stage: report it so the static 2.5D stage is drawn instead.
import { useEffect } from 'react';
import type { StageSceneProps } from './types';
export default function GpuStage({ onError }: StageSceneProps) {
  useEffect(() => onError(), [onError]);
  return null;
}
