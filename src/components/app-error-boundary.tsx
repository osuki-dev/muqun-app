import { t } from '@lingui/core/macro';
import { I18nProvider as LinguiProvider } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { RefreshCw, ShieldAlert } from 'lucide-react-native';
import { Component, useEffect, type ReactNode } from 'react';
import { SplashScreen } from '@osuki-dev/react-native-splash';
import { Pressable, StyleSheet, View } from 'react-native';

import { i18n } from '@/i18n';

/**
 * A last-resort guard around the whole app. A JS render error anywhere in the
 * tree would otherwise unmount everything and, in a release build, show a blank
 * crash. This catches it and offers a reset so a transient fault does not end
 * the session. Native crashes (GPU, sockets) are outside its reach, but a
 * render throw -- a bad state, an unexpected shape -- is the common case.
 *
 * The fallback brings its own `LinguiProvider` rather than reading an ancestor's.
 * This boundary sits *outside* `AppI18nProvider` on purpose, so that a fault in
 * locale resolution shows this screen instead of a blank app -- which left the
 * `<Trans>` below with no provider to read, and it threw while rendering the
 * fallback. React has no boundary left at that point: the fallback render never
 * commits, so `componentDidCatch` never runs and the *original* error is
 * swallowed, leaving only a misleading "rendered without I18nProvider" to debug.
 *
 * `i18n` is the module-level singleton the app already activated, so this costs
 * nothing and keeps the one screen a user sees when everything else has failed
 * in their own language.
 */
type State = { error: Error | null };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('App error boundary caught:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <LinguiProvider i18n={i18n}>
        <ErrorRecovery onRetry={() => this.setState({ error: null })} />
      </LinguiProvider>
    );
  }
}

/** Keep recovery independent of theme artwork, network and router state. */
function ErrorRecovery({ onRetry }: { onRetry: () => void }) {
  const { colors } = useThemeTokens();
  useEffect(() => {
    // A startup render failure can happen before LaunchOverlay mounts.
    // Uncover recovery instead of leaving the native launch screen pinned.
    void SplashScreen.hide().catch(() => undefined);
  }, []);
  return (
    <View style={[styles.shell, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: colors.background }]}>
          <ShieldAlert size={32} color={colors.text} accessible={false} />
        </View>
        <Text variant="heading" style={[styles.text, { color: colors.text }]}>
          <Trans>Something went wrong</Trans>
        </Text>
        <Text variant="bodySmall" style={[styles.detail, { color: colors.textMuted }]}>
          <Trans>The screen hit an error. Try again — your servers stay paired.</Trans>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Try again`}
          onPress={onRetry}
          style={styles.button}>
          <RefreshCw size={18} color="#FFFFFF" accessible={false} />
          <Text variant="label" style={styles.buttonText}>
            <Trans>Try again</Trans>
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
    backgroundColor: '#08111B',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
    gap: 16,
    alignItems: 'center',
  },
  icon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  text: {
    color: '#F4F7FB',
    textAlign: 'center',
  },
  detail: {
    color: '#9FB0C0',
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    minHeight: 46,
    paddingHorizontal: 24,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF5A4A',
  },
  buttonText: {
    color: '#FFFFFF',
  },
});
