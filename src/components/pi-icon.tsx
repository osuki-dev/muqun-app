import { AppIcon } from '@/icons/app-icon';

/** Artwork provenance is recorded in assets/glyphs/README.md. */
export function PiIcon({ size = 18, color }: { size?: number; color: string }) {
  return <AppIcon name="brand-pi" size={size} color={color} />;
}
