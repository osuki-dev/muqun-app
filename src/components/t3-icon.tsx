import { AppIcon } from '@/icons/app-icon';

/** Artwork provenance is recorded in assets/glyphs/README.md. */
export function T3Icon({ size = 18, color }: { size?: number; color: string }) {
  return <AppIcon name="brand-t3" size={(size * 74) / 111} color={color} />;
}
