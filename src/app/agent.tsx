import { useRef } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { EdgeFade } from '@/components/edge-fade';
import { ThemeArtwork } from '@/components/theme-artwork';
import { AgentWorkbench } from '@/components/agent-workbench';
import { SessionActionIcon, WorkspacePillContent } from '@/components/agent-header-morph';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useAgentSessionState } from '@/stores/agent-session-state';

/**
 * The header's height above the content, with generous clearance so the glass pill
 * navigation never presses down on the scrolling content.
 */
const HEADER_INSET = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 24;

/** `ses_…` placeholders are engine bookkeeping, not a title worth showing. */
function isMeaningfulSessionTitle(title: string | undefined): boolean {
  return Boolean(title && !title.startsWith('ses_'));
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
  const router = useRouter();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const params = useLocalSearchParams<{ sessionId?: string; asid?: string }>();

  const sessionId = params.sessionId || 'herdr';
  const sessionRunning = useAgentSessionState((s) => s.running);
  const sessionTitle = useAgentSessionState((s) => s.title);
  const activeDirectory = useAgentSessionState((s) => s.directory);
  const activeProject = useAgentSessionState((s) => s.project);

  const createNewSessionRef = useRef<(() => void) | null>(null);
  const abortSessionRef = useRef<(() => void) | null>(null);

  const displayWorkspaceName =
    activeProject?.name ||
    (activeDirectory ? activeDirectory.split('/').filter(Boolean).pop() : undefined) ||
    t`Workspace`;
  const displayWorkspacePath = activeDirectory || activeProject?.canonical || '~/';
  const showSessionTitle = sessionRunning && isMeaningfulSessionTitle(sessionTitle);

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
        createNewSessionRef={createNewSessionRef}
        abortSessionRef={abortSessionRef}
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
                onPress={() => router.push({ pathname: '/agent-workspace', params: { sessionId } })}
                accessibilityRole="button"
                accessibilityLabel={switchWorkspaceLabel}
                style={styles.workspaceHeaderPillInner}>
                <WorkspacePillContent
                  showSession={showSessionTitle}
                  sessionTitle={sessionTitle}
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
                accessibilityLabel={sessionRunning ? t`Stop agent` : t`New session`}
                onPress={() => {
                  if (sessionRunning) {
                    abortSessionRef.current?.();
                  } else {
                    createNewSessionRef.current?.();
                  }
                }}
                style={styles.newSessionCircleInner}>
                <SessionActionIcon running={sessionRunning} />
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
});
