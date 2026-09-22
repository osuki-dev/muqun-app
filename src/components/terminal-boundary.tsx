import { Trans, useLingui } from '@lingui/react/macro';
import { Text } from '@/components/text';
import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

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
          <Trans>This terminal could not be drawn.</Trans>
        </Text>
        <TerminalRetry
          textColor={this.props.textColor}
          onPress={() => this.setState({ failed: false })}
        />
      </View>
    );
  }
}

function TerminalRetry({ textColor, onPress }: { textColor: string; onPress: () => void }) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  return (
    <PressableScale
      accessibilityLabel={t`Retry drawing the terminal`}
      onPress={onPress}
      style={[styles.retry, { borderColor: textColor, borderRadius: profile.radius.pill }]}>
      <Text variant="caption" color={textColor}>
        <Trans>Retry</Trans>
      </Text>
    </PressableScale>
  );
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
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
