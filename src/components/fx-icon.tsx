import { AppIcon } from '@/icons/app-icon';

/** Artwork provenance is recorded in assets/glyphs/README.md. */
export function FxIcon({ size = 18, color }: { size?: number; color: string }) {
  return <AppIcon name="brand-fx" size={size} color={color} />;
}
