import { useCallback, useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronDown, Cpu, FolderGit2, Plus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { EdgeFade } from '@/components/edge-fade';
import { ThemeArtwork } from '@/components/theme-artwork';
import { AgentWorkbench } from '@/components/agent-workbench';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { AgentProject, ModelRef } from '@/lib/agent-session';

/**
 * The header's height above the content, with generous clearance so the glass pill
 * navigation never presses down on the scrolling content.
 */
const HEADER_INSET = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 24;

function formatModelName(model?: ModelRef): string {
  if (!model?.model_id) return 'Model';
  const modelId = model.model_id;
  const known: Record<string, string> = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
    'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gpt-6-astra': 'GPT-6 Astra',
    'gpt-6-astra-fast': 'GPT-6 Astra Fast',
    'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
    'ling-3.0-flash-fin-free': 'Ling 3.0 Flash',
  };
  const baseName =
    known[modelId] ||
    modelId
      .split(/[-_]/)
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');

  if (model.variant) {
    const varLabel =
      model.variant === 'xhigh'
        ? 'Max'
        : model.variant.charAt(0).toUpperCase() + model.variant.slice(1);
    return `${baseName} • ${varLabel}`;
  }
  return baseName;
}

/**
 * Dedicated OpenCode Agent Screen.
 *
 * The top bar features:
 * 1. The interactive project / workspace pill in the center (touch to switch workspaces)
 * 2. Dedicated '+' New Session button and Model picker on the right.
 */
export default function AgentScreen() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const params = useLocalSearchParams<{ sessionId?: string; asid?: string }>();

  const sessionId = params.sessionId || 'herdr';
  const [activeModel, setActiveModel] = useState<ModelRef | undefined>(undefined);
  const [activeDirectory, setActiveDirectory] = useState<string | undefined>(undefined);
  const [activeProject, setActiveProject] = useState<AgentProject | undefined>(undefined);

  const openModelSheetRef = useRef<(() => void) | null>(null);
  const openWorkspaceSheetRef = useRef<(() => void) | null>(null);
  const createNewSessionRef = useRef<(() => void) | null>(null);

  const handleWorkspaceChange = useCallback(
    (directory?: string, project?: AgentProject) => {
      setActiveDirectory(directory);
      setActiveProject(project);
    },
    []
  );

  const modelDisplayName = formatModelName(activeModel);
  const displayWorkspaceName =
    activeProject?.name ||
    (activeDirectory ? activeDirectory.split('/').filter(Boolean).pop() : undefined) ||
    t`Workspace`;
  const displayWorkspacePath = activeDirectory || activeProject?.canonical || '~/';

  return (
    <View style={[styles.page, { backgroundColor: surfaceBackground(theme.colors.background) }]}>
      <ThemeArtwork slot="shell.background" />
      <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />

      <AgentWorkbench
        sessionId={sessionId}
        initialAsid={params.asid}
        topInset={insets.top + HEADER_INSET}
        bottomInset={insets.bottom}
        onModelChange={setActiveModel}
        openModelSheetRef={openModelSheetRef}
        onWorkspaceChange={handleWorkspaceChange}
        openWorkspaceSheetRef={openWorkspaceSheetRef}
        createNewSessionRef={createNewSessionRef}
      />

      {/* Top glass fade for smooth dissolve under nav header */}
      <EdgeFade
        edge="top"
        color={theme.colors.background}
        style={[styles.topFade, { height: insets.top + HEADER_INSET + 20 }]}
      />

      {/* Pinned top navigation bar */}
      <View pointerEvents="box-none" style={styles.header}>
        <ScreenHeader
          titlePill={
            <GlassChrome surface="navigation" style={styles.workspaceHeaderPill}>
              <PressableScale
                testID="agent-header-workspace-pill"
                onPress={() => openWorkspaceSheetRef.current?.()}
                accessibilityRole="button"
                accessibilityLabel={t`Switch workspace: ${displayWorkspaceName}`}
                style={styles.workspaceHeaderPillInner}>
                <FolderGit2 size={15} color={theme.colors.primary} />
                <Text
                  variant="bodySmall"
                  weight="bold"
                  numberOfLines={1}
                  color={theme.colors.text}
                  style={styles.workspacePillName}>
                  {displayWorkspaceName}
                </Text>
                <Text
                  variant="caption"
                  numberOfLines={1}
                  color={theme.colors.textMuted}
                  style={styles.workspacePillPath}>
                  {displayWorkspacePath}
                </Text>
                <ChevronDown size={13} color={theme.colors.textMuted} />
              </PressableScale>
            </GlassChrome>
          }
          rightPill={
            <View style={styles.headerRightActions}>
              <GlassChrome surface="navigation" style={styles.newSessionCircle}>
                <PressableScale
                  testID="agent-header-new-session"
                  accessibilityRole="button"
                  accessibilityLabel={t`New session`}
                  onPress={() => createNewSessionRef.current?.()}
                  style={styles.newSessionCircleInner}>
                  <Plus size={18} color={theme.colors.text} strokeWidth={2.2} />
                </PressableScale>
              </GlassChrome>

              <GlassChrome surface="navigation" style={styles.modelHeaderPill}>
                <PressableScale
                  testID="agent-header-model-pill"
                  onPress={() => openModelSheetRef.current?.()}
                  accessibilityRole="button"
                  accessibilityLabel={t`Select model`}
                  style={styles.modelHeaderPillInner}>
                  <Cpu size={14} color={theme.colors.primary} />
                  <Text
                    variant="caption"
                    weight="semibold"
                    numberOfLines={1}
                    color={theme.colors.text}
                    style={styles.modelPillText}>
                    {modelDisplayName}
                  </Text>
                  <ChevronDown size={12} color={theme.colors.textMuted} />
                </PressableScale>
              </GlassChrome>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 },
  workspaceHeaderPill: {
    flex: 1,
    minWidth: 0,
    height: NAV_HEADER_CONTROL_SIZE,
    borderRadius: appChrome.radius.navigationPill,
    borderCurve: 'continuous',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  workspaceHeaderPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: NAV_HEADER_CONTROL_SIZE,
    gap: 6,
  },
  workspacePillName: {
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
  },
  workspacePillPath: {
    fontSize: 11,
    flexShrink: 1,
    includeFontPadding: false,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  newSessionCircle: {
    width: NAV_HEADER_CONTROL_SIZE,
    height: NAV_HEADER_CONTROL_SIZE,
    borderRadius: NAV_HEADER_CONTROL_SIZE / 2,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newSessionCircleInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelHeaderPill: {
    height: NAV_HEADER_CONTROL_SIZE,
    borderRadius: appChrome.radius.navigationPill,
    borderCurve: 'continuous',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  modelHeaderPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: NAV_HEADER_CONTROL_SIZE,
    gap: 5,
    maxWidth: 135,
  },
  modelPillText: {
    flexShrink: 1,
    fontSize: 12,
  },
});
