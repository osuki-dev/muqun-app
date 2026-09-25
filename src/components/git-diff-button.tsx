import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useRouter, type Href } from 'expo-router';
import { GitCompare } from 'lucide-react-native';
import { Keyboard, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { KEY_ROW_HEIGHT } from '@/constants/key-row';
import { useGitRepoStatus } from '@/hooks/use-git-repo-status';
import { badgeCount } from '@/lib/git-diff';

/**
 * The way into what the pane has changed.
 *
 * Third in the pane's action row, after Quick actions and Files, and the
 * ordering is the argument for the position: Quick actions is what you send
 * *into* the session, Files is what the session wrote *out*, and this is what
 * the session has changed *in place*. All three are things the pane did, so all
 * three live in the content zone rather than in the chrome.
 *
 * **It is not always there, and that is the design.** The control draws nothing
 * at all unless two separate things are true -- the gateway declared `git_diff`,
 * and this pane's own context says its directory is a checkout. A capability is
 * a static promise about the API; being in a repository is an observation about
 * one pane. Neither alone is enough, and on an older gateway the icon does not
 * appear disabled or empty: it does not exist, and nothing is ever requested.
 *
 * The badge is the one number that makes the icon worth glancing at. Files
 * rather than lines, because files is the calmer number and the one that
 * answers "is there anything to look at" without implying a size.
 */
export function GitDiffButton({
  sessionId,
  paneId,
  cwd,
  label,
  capabilities,
  disabled,
  background,
  compact = false,
}: {
  sessionId: string;
  /** The selected pane, so the sheet asks about this checkout only. */
  paneId: string;
  /** The pane's working directory: the cache key, and the whole question. */
  cwd: string | null | undefined;
  /** The server's name, carried through to the sheet's subtitle. */
  label: string;
  /** `health.capabilities`, as the workspace already holds it. */
  capabilities: readonly string[] | undefined | null;
  disabled?: boolean;
  /** The row's glass fill, so this matches the buttons beside it. */
  background: string;
  /** Pad docks have less vertical chrome even though they have more width. */
  compact?: boolean;
}) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch. The hook's `t` is bound to the Lingui context, so the
  // compiler sees a dependency that actually changes. See `ArtifactsButton`.
  const { t } = useLingui();

  const router = useRouter();
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const repo = useGitRepoStatus({ sessionId, paneId, cwd, capabilities, enabled: !disabled });

  // Nothing to show, so nothing is drawn -- the `FileMentionPanel` discipline.
  // A disabled icon here would be the app claiming there is a diff to look at
  // and then refusing to open it.
  if (!repo.available) return null;

  const count = badgeCount(repo.changedFiles);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Open changes`}
      feedback="selection"
      pressedScale={0.9}
      disabled={disabled}
      onPress={() => {
        // The sheet would otherwise open behind the on-screen keyboard.
        Keyboard.dismiss();
        // `navigate`, not `push`. A push always adds a route, and the sheet
        // takes a moment to arrive -- the route mounts, the form sheet animates
        // up, and against a real gateway it then sits on a header while the
        // file list is asked for. For that whole moment this button is still
        // the thing under the reader's thumb, and a second tap used to stack a
        // second identical sheet. `navigate` updates the route already on the
        // stack instead, so the second tap is the no-op it was meant to be.
        // See `artifacts-button.tsx`, where this was diagnosed.
        router.navigate({
          pathname: '/git-diff',
          params: { sessionId, paneId, label, branch: repo.branch ?? '' },
        } as unknown as Href);
      }}
      style={[
        styles.button,
        compact && styles.compactButton,
        { borderRadius: profile.chrome.control },
        { backgroundColor: surfaceBackground(background) },
      ]}>
      <GitCompare
        size={compact ? 15 : 16}
        color={theme.colors.primary}
        style={repo.changedFiles > 0 ? styles.iconNudged : undefined}
      />
      {repo.changedFiles > 0 ? (
        // Not announced separately: the label above already says what the
        // control does, and a screen reader reading "Open changes, 3" as two
        // items is worse than reading one. The count is a glance affordance.
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.badge,
            compact && styles.compactBadge,
            { backgroundColor: surfaceBackground(theme.colors.primary) },
          ]}>
          <Text
            variant="caption"
            hugSlack={false}
            color={theme.colors.onPrimary}
            style={styles.badgeText}>
            {count}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    // Matched to `keyRowToggle` in the server screen, so the row reads as one
    // set of controls. The height is imported rather than restated: agreeing on
    // 36 by coincidence is what let the row go ragged in the first place.
    width: 40,
    height: KEY_ROW_HEIGHT,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
  },
  // Overhanging the corner rather than inside it: the glyph is 16pt in a 40pt
  // box, so a badge that stayed within the bounds would either cover the icon
  // or be too small to read.
  badge: {
    // Inside the button, not hung off its corner: the key row is a horizontal
    // scroll view and every ancestor between it and the sheet clips, so a
    // badge that crossed the button's edge lost its top and right on the
    // device. The icon steps down and left by the same amount to make room.
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    borderCurve: 'continuous',
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactBadge: {
    top: 2,
    right: 2,
    minWidth: 13,
    height: 13,
    borderRadius: 6.5,
  },
  iconNudged: {
    marginTop: 3,
    marginRight: 3,
  },
  badgeText: {
    fontSize: 9,
    lineHeight: 11,
    includeFontPadding: false,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
