import { create } from 'zustand';
import type { UpdatePhase } from '@/lib/app-update-controller';

/** A user-opened snapshot: later checks cannot replace the notes being read. */
export const useUpdateDetails = create<{
  notes: string | null;
  bundled: boolean;
  phase: UpdatePhase | null;
}>(() => ({
  notes: null,
  bundled: false,
  phase: null,
}));
export function openUpdateDetails(notes: string | undefined, phase: UpdatePhase | null = null) {
  const text = notes?.trim();
  if (text) useUpdateDetails.setState({ notes: text, bundled: false, phase });
}
export function openBundledReleaseNotes() {
  useUpdateDetails.setState({ notes: null, bundled: true, phase: null });
}
export function closeUpdateDetails() {
  useUpdateDetails.setState({ notes: null, bundled: false, phase: null });
}
