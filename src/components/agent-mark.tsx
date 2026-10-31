import { AgentIcon } from '@/icons';

import { ClaudeIcon } from '@/components/claude-icon';
import { CodexIcon } from '@/components/codex-icon';
import { DeepSeekIcon } from '@/components/deepseek-icon';
import { OpenCodeIcon } from '@/components/opencode-icon';
import { PiIcon } from '@/components/pi-icon';
import { FxIcon } from '@/components/fx-icon';
import { QoderIcon } from '@/components/qoder-icon';
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
    case 'codex':
      return <CodexIcon size={size} color={color} />;
    case 'opencode':
      return <OpenCodeIcon size={size} color={color} />;
    case 'deepseek':
      return <DeepSeekIcon size={size} color={color} />;
    case 't3':
      return <T3Icon size={size} color={color} />;
    case 'pi':
      return <PiIcon size={size} color={color} />;
    case 'fx':
      return <FxIcon size={size} color={color} />;
    case 'qoder':
      return <QoderIcon size={size} color={color} />;
    case 'claude':
      return <ClaudeIcon size={size} color={color} />;
    default:
      return <AgentIcon size={size} color={color} />;
  }
}
