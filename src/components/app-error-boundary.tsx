import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

/**
 * A last-resort guard around the whole app. A JS render error anywhere in the
 * tree would otherwise unmount everything and, in a release build, show a blank
 * crash. This catches it and offers a reset so a transient fault does not end
 * the session. Native crashes (GPU, sockets) are outside its reach, but a
 * render throw -- a bad state, an unexpected shape -- is the common case.
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
      <View style={styles.shell}>
        <Text variant="heading" style={styles.text}>
          <Trans>Something went wrong</Trans>
        </Text>
        <Text variant="bodySmall" style={styles.detail}>
          <Trans>The screen hit an error. Try again — your servers stay paired.</Trans>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Try again`}
          onPress={() => this.setState({ error: null })}
          style={styles.button}>
          <Text variant="label" style={styles.buttonText}>
            <Trans>Try again</Trans>
          </Text>
        </Pressable>
      </View>
    );
  }
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
  text: {
    color: '#F4F7FB',
    textAlign: 'center',
  },
  detail: {
    color: '#9FB0C0',
    textAlign: 'center',
  },
  button: {
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
