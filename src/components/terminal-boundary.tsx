import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';

/**
 * Keeps a render failure in the terminal from taking down the whole app.
 *
 * The terminal is the one place that runs native GPU code (Skia) and parses
 * arbitrary bytes off the wire, so it is the most likely thing to throw --
 * switching render modes, an unexpected escape sequence, a font that failed to
 * load. When it does, this shows a retry instead of a blank crash, and the rest
 * of the app (the drawer, other servers) stays usable.
 */
type Props = {
  children: ReactNode;
  /** Bumping this resets the boundary, e.g. when the pane changes. */
  resetKey?: string;
  background: string;
  textColor: string;
};

type State = { failed: boolean };

export class TerminalBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(previous: Props) {
    // A new pane should get a clean slate rather than inherit the last one's
    // failure.
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={[styles.shell, { backgroundColor: this.props.background }]}>
        <Text variant="bodySmall" color={this.props.textColor} style={styles.text}>
          <Trans>This panel could not be drawn.</Trans>
        </Text>
        <PressableScale
          accessibilityLabel={t`Retry drawing the panel`}
          onPress={() => this.setState({ failed: false })}
          style={[styles.retry, { borderColor: this.props.textColor }]}>
          <Text variant="caption" color={this.props.textColor}>
            <Trans>Retry</Trans>
          </Text>
        </PressableScale>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  text: {
    textAlign: 'center',
  },
  retry: {
    minHeight: 40,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
