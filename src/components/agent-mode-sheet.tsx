import { memo, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spinner, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Bot, Compass, FileText, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import { getAgentCatalog, type AgentInfo } from '@/lib/agent-session';

const STAGGERED_ROWS = 8;

/**
 * Choose an agent, as a native form sheet route.
 *
 * `sheet-scene.tsx`'s shape. The mode -- primary or subagent -- is part of the
 * row's caption rather than a coloured chip: it is a fact about the agent, and
 * one accent is enough for one sheet.
 */
export interface AgentModeSheetProps {
  /** The gateway session whose catalog is listed. */
  sessionId?: string;
  selectedAgent?: string;
  onSelectAgent: (agent: string) => void;
  onClose: () => void;
}

const BUILTIN_IDS = ['build', 'plan', 'explore', 'general'];

function agentIcon(id: string, color: string) {
  switch (id) {
    case 'build':
      return <Bot size={17} color={color} />;
    case 'explore':
      return <Compass size={17} color={color} />;
    case 'plan':
      return <FileText size={17} color={color} />;
    default:
      return <Sparkles size={17} color={color} />;
  }
}

export const AgentModeSheet = memo(function AgentModeSheet({
  sessionId,
  selectedAgent,
  onSelectAgent,
  onClose: _onClose,
}: AgentModeSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const builtinAgents = useMemo<AgentInfo[]>(
    () => [
      {
        id: 'build',
        name: t`Build`,
        description: t`Autonomous software engineering: edits files, runs commands, tests.`,
        mode: 'primary',
      },
      {
        id: 'plan',
        name: t`Plan`,
        description: t`Architecture, design proposals, step-by-step roadmaps.`,
        mode: 'primary',
      },
      {
        id: 'explore',
        name: t`Explore`,
        description: t`Read-only: symbol search, file discovery, dependency tracing.`,
        mode: 'subagent',
      },
      {
        id: 'general',
        name: t`General`,
        description: t`Conversational help and open-ended workspace questions.`,
        mode: 'primary',
      },
    ],
    [t]
  );

  // A route mounts when it opens and unmounts when it is dismissed, so the
  // catalog is fetched once per opening without a `visible` flag to watch.
  useEffect(() => {
    let active = true;
    setLoading(true);
    getAgentCatalog(sessionId)
      .then((catalog) => {
        if (!active) return;
        setAgents(catalog?.agents && catalog.agents.length > 0 ? catalog.agents : builtinAgents);
      })
      .catch((err) => {
        console.warn('Failed to load agent catalog:', err);
        if (active) setAgents(builtinAgents);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, builtinAgents]);

  const displayAgents = agents.length > 0 ? agents : builtinAgents;

  const modeLabel = (agent: AgentInfo): string => {
    const mode = agent.mode?.toLowerCase();
    if (mode === 'subagent' || agent.id === 'explore') return t`Subagent`;
    if (mode === 'primary' || BUILTIN_IDS.includes(agent.id)) return t`Primary`;
    return t`Custom`;
  };

  const current = displayAgents.find((agent) => agent.id === selectedAgent);

  return (
    <SheetScene
      testID="agent-mode-sheet"
      title={t`Choose an agent`}
      caption={current ? current.name || current.id : selectedAgent}>
      {loading ? (
        <View style={styles.loading}>
          <Spinner size="lg" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          showsVerticalScrollIndicator={false}>
          <SheetSceneGroupHeading title={t`Agents on this host`} first />
          {displayAgents.map((agent, index) => {
            const isSelected = selectedAgent === agent.id;
            return (
              <Animated.View
                key={agent.id}
                entering={index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')}
                layout={listLayout('short')}>
                <SheetSceneRow
                  testID={`agent-mode-row-${agent.id}`}
                  title={agent.name || agent.id}
                  caption={[modeLabel(agent), agent.description].filter(Boolean).join(' · ')}
                  selected={isSelected}
                  leading={agentIcon(
                    agent.id,
                    isSelected ? theme.colors.primary : theme.colors.textSubtle
                  )}
                  onPress={() => onSelectAgent(agent.id)}
                />
              </Animated.View>
            );
          })}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </ScrollView>
      )}
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  loading: { padding: 40, alignItems: 'center', justifyContent: 'center' },
});
