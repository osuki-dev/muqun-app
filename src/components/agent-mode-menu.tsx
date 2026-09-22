import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Bot, Check, Compass, Sparkles } from 'lucide-react-native';
import Animated from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import { fadeInDown, fadeOutDown } from '@/lib/motion';
import type { AgentInfo } from '@/lib/agent-session';

export interface AgentModeMenuProps {
  agents: AgentInfo[];
  selectedAgent?: string;
  onSelectAgent: (agentId: string) => void;
  textColor: string;
}

function renderAgentIcon(id: string, color: string) {
  switch (id) {
    case 'explore':
      return <Compass size={17} color={color} />;
    case 'general':
      return <Bot size={17} color={color} />;
    default:
      return <Sparkles size={17} color={color} />;
  }
}

export const AgentModeMenu = memo(function AgentModeMenu({
  agents,
  selectedAgent = 'build',
  onSelectAgent,
  textColor,
}: AgentModeMenuProps) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  return (
    <Animated.View
      testID="agent-mode-menu"
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      style={[
        styles.menu,
        { borderRadius: profile.chrome.popover },
        {
          backgroundColor: surfaceBackground(theme.colors.surface),
          borderColor: theme.colors.border,
        },
      ]}>
      {agents.map((ag) => {
        const isSelected = (selectedAgent || 'build') === ag.id;
        return (
          <PressableScale
            key={ag.id}
            testID={`agent-mode-option-${ag.id}`}
            accessibilityLabel={ag.name || ag.id}
            onPress={() => onSelectAgent(ag.id)}
            style={[
              styles.option,
              { borderRadius: profile.chrome.control },
              isSelected && { backgroundColor: withAlpha(theme.colors.primary, 0.09) },
            ]}>
            <View style={styles.optionLeft}>
              {renderAgentIcon(ag.id, isSelected ? theme.colors.primary : theme.colors.textMuted)}
              <View style={styles.textWrap}>
                <Text
                  variant="bodySmall"
                  weight={isSelected ? 'semibold' : 'regular'}
                  color={isSelected ? theme.colors.primary : textColor}>
                  {ag.name || ag.id}
                </Text>
                {ag.description ? (
                  <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                    {ag.description}
                  </Text>
                ) : null}
              </View>
            </View>
            {isSelected ? <Check size={16} color={theme.colors.primary} strokeWidth={2.5} /> : null}
          </PressableScale>
        );
      })}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  menu: {
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    marginBottom: 7,
    minWidth: 210,
    maxWidth: 300,
    paddingVertical: 5,
    borderRadius: appChrome.radius.popover,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: appChrome.shadow.popover,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginHorizontal: 4,
    gap: 10,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
});
