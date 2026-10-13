// The web surface uses the same accessible list. Native modules never enter its renderer.
import { useEffect } from 'react';
import type { ComputerMapSceneProps } from './types';
export default function GpuMap({ onError }: ComputerMapSceneProps) {
  useEffect(() => onError(), [onError]);
  return null;
}
