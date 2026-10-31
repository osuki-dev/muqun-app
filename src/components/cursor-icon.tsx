import { AppIcon } from '@/icons/app-icon';

/** Artwork provenance is recorded in assets/glyphs/README.md. */
export function CursorIcon({ size = 18, color }: { size?: number; color: string }) {
  return <AppIcon name="brand-cursor" size={size} color={color} />;
}
