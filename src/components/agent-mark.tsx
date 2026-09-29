import { Bot } from 'lucide-react-native';

import { OpenCodeIcon } from '@/components/opencode-icon';

/**
 * An agent's mark: the brand's own for a kind this build ships art for, and a
 * generic glyph for everything else -- so an agent the gateway learns about
 * tomorrow appears on Home today, with no art.
 */
export function AgentMark({ kind, size, color }: { kind: string; size: number; color: string }) {
  if (kind === 'opencode') return <OpenCodeIcon size={size} color={color} />;
  return <Bot size={size} color={color} strokeWidth={2} />;
}
