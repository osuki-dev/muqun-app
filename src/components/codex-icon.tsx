import { AppIcon } from '@/icons/app-icon';

/** Artwork provenance is recorded in assets/glyphs/README.md. */
export function CodexIcon({ size = 18, color }: { size?: number; color: string }) {
  return <AppIcon name="brand-codex" size={size} color={color} />;
}
