import { useEffect, useRef } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import {
  useIsFocused,
  useLocalSearchParams,
  useNavigation,
  usePathname,
  useRouter,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { ScreenHeader } from '@/components/screen-header';
import { EdgeFade } from '@/components/edge-fade';
import { ThemeArtwork } from '@/components/theme-artwork';
import { AgentWorkbench } from '@/components/agent-workbench';
import { SessionActionIcon, WorkspacePillContent } from '@/components/agent-header-morph';
import { AgentTitlePill } from '@/components/agent-title-pill';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { LogoLoader } from '@/components/logo-loader';
import { workspaceDisplayName } from '@/lib/agent-protocol';
import { useAgentSessionState } from '@/stores/agent-session-state';
import { hasRealSessionTitle } from '@/lib/agent-session';
import { consumeNewOpenCodeIntent } from '@/lib/home-commands';
import {
  isAgentWorkbenchOwnedOverlayPath,
  isAgentWorkbenchOwnedRootRoute,
} from '@/lib/agent-workbench-global-owner';

/**
 * The header's height above the content, with generous clearance so the glass pill
 * navigation never presses down on the scrolling content.
 */
const HEADER_INSET = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 24;

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
  const routeFocused = useIsFocused();
  const pathname = usePathname();
  const rootNavigation = useNavigation('/');
  const rootNavigationState = rootNavigation.getState();
  const rootRouteName = rootNavigationState
    ? rootNavigationState.routes[rootNavigationState.index]?.name
    : undefined;
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const params = useLocalSearchParams<{
    sessionId?: string;
    asid?: string;
    server?: string;
    directory?: string;
    intent?: string;
  }>();

  const sessionId = params.sessionId || 'herdr';

  /**
   * Which server this screen is for.
   *
   * A Home card names its server on the route. The workbench reads the
   * gateway that is *selected*, so until the selected record is that server
   * nothing is mounted -- a workbench that came up on the previous selection
   * would already have listed the wrong machine's sessions. Opened without a
   * server (the drawer, a deep link), the selected one is the one meant.
   */
  const { record, selectRecord } = useGatewayRecord();
  const wantedServer = typeof params.server === 'string' && params.server ? params.server : null;
  const serverReady = !wantedServer || record?.serverId === wantedServer;
  const newSessionIntent = params.intent === 'new';
  useEffect(() => {
    if (!newSessionIntent || !wantedServer) return;
    consumeNewOpenCodeIntent(wantedServer, params.directory);
  }, [newSessionIntent, params.directory, wantedServer]);
  useEffect(() => {
    if (!wantedServer || serverReady) return;
    void selectRecord(wantedServer);
  }, [wantedServer, serverReady, selectRecord]);
  const sessionRunning = useAgentSessionState((s) => s.running);
  const sessionTitle = useAgentSessionState((s) => s.title);
  const activeDirectory = useAgentSessionState((s) => s.directory);
  const activeProject = useAgentSessionState((s) => s.project);
  const activeWorktree = useAgentSessionState((s) => s.worktree);
  const workbenchVisible =
    routeFocused ||
    isAgentWorkbenchOwnedRootRoute(rootRouteName) ||
    isAgentWorkbenchOwnedOverlayPath(pathname);

  const createNewSessionRef = useRef<(() => void) | null>(null);
  const abortSessionRef = useRef<(() => void) | null>(null);

  const displayWorkspaceName = workspaceDisplayName(activeProject, activeDirectory, t`Project`);
  const displayWorkspacePath = activeDirectory || activeProject?.canonical || '~/';
  /**
   * The title, whenever there is one.
   *
   * It used to appear only while the agent was producing output, so the
   * auto-title that lands on the first turn was shown for a few seconds and
   * then replaced by the workspace name the reader already knew -- and the
   * session they were reading became anonymous the moment it went quiet. The
   * workspace is one tap away either way; the title is what identifies what is
   * on screen.
   */
  const showSessionTitle = hasRealSessionTitle({ title: sessionTitle });

  /**
   * The pill opens whatever it is showing.
   *
   * It used to open the workspace switcher whatever it said, so tapping a
   * session's title -- which is what the pill shows whenever a session has one
   * -- offered a list of directories, and the screen reader announced "Switch
   * workspace" over the session's name. A control that says one thing and does
   * another is worse than either.
   */
  // react-doctor-disable-next-line react-hooks-js/todo -- lingui t macro; the lingui babel plugin compiles the template away before the compiler sees it
  const openSessionsLabel = t`Sessions: ${sessionTitle ?? ''}`;

  return (
    <View style={[styles.page, { backgroundColor: surfaceBackground(theme.colors.background) }]}>
      <ThemeArtwork slot="shell.background" />
      <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />

      {serverReady ? (
        <AgentWorkbench
          // Keyed on the server: switching servers is a new workbench, not
          // the old one told to look elsewhere.
          key={JSON.stringify([
            record?.serverId ?? 'none',
            newSessionIntent ? 'new' : 'existing',
            params.sessionId ?? '',
            params.asid ?? '',
            params.directory ?? '',
          ])}
          serverId={wantedServer ?? record?.serverId ?? ''}
          sessionId={sessionId}
          initialAsid={newSessionIntent ? undefined : params.asid}
          initialDirectory={params.directory}
          initialIntent={newSessionIntent ? 'new' : undefined}
          visible={workbenchVisible}
          topInset={insets.top + HEADER_INSET}
          bottomInset={insets.bottom}
          createNewSessionRef={createNewSessionRef}
          abortSessionRef={abortSessionRef}
        />
      ) : (
        <View style={styles.serverWait} pointerEvents="none">
          <LogoLoader size={56} accessibilityLabel={t`Connecting`} />
        </View>
      )}

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
            <GlassChrome
              surface="navigation"
              shape="navigationPill"
              style={styles.workspaceHeaderPill}>
              {/* The pill keeps its tap -- it opens whatever it is showing --
                  and gains a horizontal swipe between the workspace's
                  sessions. Both live in `AgentTitlePill`, which reads the
                  strip's order from the same store the workbench publishes it
                  to, so the header and the strip can never disagree about
                  which session is next. */}
              <AgentTitlePill
                testID="agent-header-workspace-pill"
                // One dropdown, one sheet. It used to open the Sessions sheet
                // when a session's title was showing and the project sheet when
                // it was not, so the same control in the same place answered
                // with two different lists and the owner could not tell why.
                // Projects are reached from the first row of the Sessions
                // sheet, which also says which project this is.
                onPress={() => router.push('/agent-sessions')}
                accessibilityLabel={openSessionsLabel}
                style={styles.workspaceHeaderPillInner}>
                <WorkspacePillContent
                  showSession={showSessionTitle}
                  running={sessionRunning}
                  sessionTitle={sessionTitle}
                  worktreeName={activeWorktree}
                  workspaceName={displayWorkspaceName}
                  workspacePath={displayWorkspacePath}
                />
              </AgentTitlePill>
            </GlassChrome>
          }
          rightPill={
            <GlassChrome
              surface="navigation"
              shape="navigationPill"
              style={styles.newSessionCircle}>
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
  serverWait: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
