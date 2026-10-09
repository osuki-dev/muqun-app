import { useThemeTokens } from '@osuki-dev/ui';
import {
  CheckCircle2,
  Circle,
  CircleSlash,
  Clock,
  Hand,
  Loader,
  XCircle,
} from 'lucide-react-native';

import type { TaskState } from '@/lib/task-ledger';

/**
 * A ledger task's state as a glyph, in the theme's colours.
 *
 * Shape carries the state and colour only reinforces it, so the column reads
 * without a legend and without colour: a tick is done, a cross failed, a
 * slashed circle cancelled, a raised hand asks for the reader.
 */
export function TaskStatusGlyph({ state, size = 16 }: { state: TaskState; size?: number }) {
  const { colors } = useThemeTokens();
  switch (state) {
    case 'done':
      return <CheckCircle2 size={size} color={colors.success} strokeWidth={2.2} />;
    case 'failed':
      return <XCircle size={size} color={colors.danger} strokeWidth={2.2} />;
    case 'cancelled':
      return <CircleSlash size={size} color={colors.textSubtle} strokeWidth={2} />;
    case 'waiting':
      return <Hand size={size} color={colors.warning} strokeWidth={2.2} />;
    case 'working':
    case 'dispatching':
      return <Loader size={size} color={colors.primary} strokeWidth={2.2} />;
    case 'idle_unconfirmed':
      return <Clock size={size} color={colors.textMuted} strokeWidth={2} />;
    case 'queued':
      return <Circle size={size - 1} color={colors.textSubtle} strokeWidth={1.8} />;
  }
}
