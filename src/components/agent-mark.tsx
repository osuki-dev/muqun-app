import { Bot } from 'lucide-react-native';

import { DeepSeekIcon } from '@/components/deepseek-icon';
import { OpenCodeIcon } from '@/components/opencode-icon';
import { T3Icon } from '@/components/t3-icon';
import { agentMarkKind } from '@/lib/agent-mark-kind';

/**
 * An agent's mark: the brand's own for a kind this build ships art for, and a
 * generic glyph for everything else -- so an agent the gateway learns about
 * tomorrow appears on Home today, with no art. `agentMarkKind` is the mapping
 * (kind -> shipped art) for callers that need to know whether art exists.
 */
export function AgentMark({ kind, size, color }: { kind: string; size: number; color: string }) {
  switch (agentMarkKind(kind)) {
    case 'opencode':
      return <OpenCodeIcon size={size} color={color} />;
    case 'deepseek':
      return <DeepSeekIcon size={size} color={color} />;
    case 't3':
      return <T3Icon size={size} color={color} />;
    default:
      return <Bot size={size} color={color} strokeWidth={2} />;
  }
}
