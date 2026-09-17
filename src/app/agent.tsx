import { useCallback, useEffect, useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronDown, FolderGit2, Plus, Square } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { EdgeFade } from '@/components/edge-fade';
import { ThemeArtwork } from '@/components/theme-artwork';
import { AgentWorkbench } from '@/components/agent-workbench';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { timing } from '@/lib/motion';
import type { AgentProject } from '@/lib/agent-session';

/**
 * The header's height above the content, with generous clearance so the glass pill
 * navigation never presses down on the scrolling content.
 */
const HEADER_INSET = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 24;

/** The run state and title the workbench reports up to the header. */
interface HeaderSessionState {
  running: boolean;
  title: string | undefined;
}

/** `ses_…` placeholders are engine bookkeeping, not a title worth showing. */
function isMeaningfulSessionTitle(title: string | undefined): boolean {
  return Boolean(title && !title.startsWith('ses_'));
}

/**
 * The `+` that becomes a Stop control while the session is producing output,
 * morphing back once it goes idle. Both icons stay mounted and crossfade so
 * the switch reads as one control changing, not two trading places.
 */
function SessionActionIcon({ running }: { running: boolean }) {
  const theme = useThemeTokens();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(running ? 1 : 0, timing('short'));
  }, [running, progress]);
  const plusStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { scale: 0.55 + 0.45 * (1 - progress.value) },
      { rotate: `${progress.value * 90}deg` },
    ],
  }));
  const stopStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.55 + 0.45 * progress.value }],
  }));
  return (
    <View pointerEvents="none" style={styles.actionIconStack}>
      <Animated.View style={[styles.actionIconLayer, plusStyle]}>
        <Plus size={18} color={theme.colors.text} strokeWidth={2.2} />
      </Animated.View>
      <Animated.View style={[styles.actionIconLayer, stopStyle]}>
        <Square
          size={14}
          color={theme.colors.danger}
          strokeWidth={2.4}
          fill={theme.colors.danger}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The workspace pill's content: the workspace name and path while the session
 * is idle, the live session title while it is producing output, crossfading
 * between the two so the change reads as one pill changing its mind.
 */
function WorkspacePillContent({
  showSession,
  sessionTitle,
  workspaceName,
  workspacePath,
}: {
  showSession: boolean;
  sessionTitle?: string;
  workspaceName: string;
  workspacePath: string;
}) {
  const theme = useThemeTokens();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(showSession ? 1 : 0, timing('short'));
  }, [showSession, progress]);
  const workspaceStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateX: -6 * progress.value }],
  }));
  const sessionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: 6 * (1 - progress.value) }],
  }));
  return (
    <View pointerEvents="none" style={styles.pillStackViewport}>
      <Animated.View style={[styles.pillStack, workspaceStyle]}>
        <FolderGit2 size={15} color={theme.colors.primary} />
        <Text
          variant="bodySmall"
          weight="bold"
          numberOfLines={1}
          color={theme.colors.text}
          style={styles.workspacePillName}>
          {workspaceName}
        </Text>
        <Text
          variant="caption"
          numberOfLines={1}
          color={theme.colors.textMuted}
          style={styles.workspacePillPath}>
          {workspacePath}
        </Text>
        <ChevronDown size={13} color={theme.colors.textMuted} />
      </Animated.View>
      <Animated.View style={[styles.pillStack, sessionStyle]}>
        <StatusDot color={theme.colors.primary} filled pulse size={7} />
        <Text
          variant="bodySmall"
          weight="bold"
          numberOfLines={1}
          color={theme.colors.text}
          style={styles.workspacePillName}>
          {sessionTitle}
        </Text>
        <ChevronDown size={13} color={theme.colors.textMuted} />
      </Animated.View>
    </View>
  );
}

/**
 * Dedicated OpenCode Agent Screen.
 *
 * The top bar features:
 * 1. The interactive project / workspace pill in the center (touch to switch
 *    workspaces), which shows the live session title while the agent is
 *    producing output and switches back once it goes idle.
 * 2. Dedicated '+' New Session button on the right, which morphs into a Stop
 *    control while the session is running.
 */
export default function AgentScreen() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const params = useLocalSearchParams<{ sessionId?: string; asid?: string }>();

  const sessionId = params.sessionId || 'herdr';
  const [activeDirectory, setActiveDirectory] = useState<string | undefined>(undefined);
  const [activeProject, setActiveProject] = useState<AgentProject | undefined>(undefined);
  const [sessionState, setSessionState] = useState<HeaderSessionState>({
    running: false,
    title: undefined,
  });

  const openWorkspaceSheetRef = useRef<(() => void) | null>(null);
  const createNewSessionRef = useRef<(() => void) | null>(null);
  const abortSessionRef = useRef<(() => void) | null>(null);

  const handleWorkspaceChange = useCallback((directory?: string, project?: AgentProject) => {
    setActiveDirectory(directory);
    setActiveProject(project);
  }, []);

  const handleSessionStateChange = useCallback((state: HeaderSessionState) => {
    setSessionState(state);
  }, []);

  const displayWorkspaceName =
    activeProject?.name ||
    (activeDirectory ? activeDirectory.split('/').filter(Boolean).pop() : undefined) ||
    t`Workspace`;
  const displayWorkspacePath = activeDirectory || activeProject?.canonical || '~/';
  const showSessionTitle = sessionState.running && isMeaningfulSessionTitle(sessionState.title);

  // react-doctor-disable-next-line react-hooks-js/todo -- lingui t macro; the lingui babel plugin compiles the template away before the compiler sees it
  const switchWorkspaceLabel = t`Switch workspace: ${displayWorkspaceName}`;

  return (
    <View style={[styles.page, { backgroundColor: surfaceBackground(theme.colors.background) }]}>
      <ThemeArtwork slot="shell.background" />
      <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />

      <AgentWorkbench
        sessionId={sessionId}
        initialAsid={params.asid}
        topInset={insets.top + HEADER_INSET}
        bottomInset={insets.bottom}
        onWorkspaceChange={handleWorkspaceChange}
        openWorkspaceSheetRef={openWorkspaceSheetRef}
        createNewSessionRef={createNewSessionRef}
        abortSessionRef={abortSessionRef}
        onSessionStateChange={handleSessionStateChange}
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
                accessibilityLabel={switchWorkspaceLabel}
                style={styles.workspaceHeaderPillInner}>
                <WorkspacePillContent
                  showSession={showSessionTitle}
                  sessionTitle={sessionState.title}
                  workspaceName={displayWorkspaceName}
                  workspacePath={displayWorkspacePath}
                />
              </PressableScale>
            </GlassChrome>
          }
          rightPill={
            <GlassChrome surface="navigation" style={styles.newSessionCircle}>
              <PressableScale
                testID="agent-header-new-session"
                accessibilityRole="button"
                accessibilityLabel={sessionState.running ? t`Stop agent` : t`New session`}
                onPress={() => {
                  if (sessionState.running) {
                    abortSessionRef.current?.();
                  } else {
                    createNewSessionRef.current?.();
                  }
                }}
                style={styles.newSessionCircleInner}>
                <SessionActionIcon running={sessionState.running} />
              </PressableScale>
            </GlassChrome>
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
  pillStackViewport: {
    flex: 1,
    minWidth: 0,
    height: '100%',
  },
  pillStack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
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
  actionIconStack: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
