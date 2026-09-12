import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Keyboard as KeyboardIcon } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { FloatingHandle } from '@/components/floating-handle';
import { GlassChrome } from '@/components/glass-chrome';
import { appChrome } from '@/constants/appearance';
import { fadeIn, fadeOutDown, riseIn } from '@/lib/motion';

/**
 * The controls an editor pane is left with, over the grid.
 *
 * ## Why nothing here is measured into the terminal
 *
 * The maintainer's brief, in one line: if nvim is open then this is a whole
 * nvim, and the keyboard and the input come over it and out again when tapped.
 *
 * A dock cannot do that. A dock is height, height comes out of the terminal,
 * and on an editor the height it comes out of is nvim's status line and its
 * command line -- the two rows a reader actually looks at while editing. Worse,
 * a dock that grows and shrinks re-lays out the terminal, and on the SSH screen
 * a terminal re-layout is a new grid, a `SIGWINCH` and a full repaint on the far
 * side. Reaching for `esc` should not resize the reader's window.
 *
 * So this reserves nothing. It is an absolutely positioned overlay inside the
 * pane, `box-none` everywhere but on its own controls, and showing or hiding it
 * cannot fire the terminal's `onLayout` because the terminal's box never
 * changes. That is the constraint the whole component exists to satisfy, and it
 * is why the panel is not simply the old dock with `position: absolute` on it:
 * the dock is measured into the terminal's bottom inset, and this deliberately
 * is not measured into anything.
 *
 * ## The two states are one control, and only one of them floats
 *
 * Collapsed it is the app's floating button (`FloatingHandle`): the only
 * chrome over the file, so the thing the reader moves out of the way of the
 * line they are reading, and it moves the way every floating control on a
 * phone moves -- it follows the finger in both axes and parks against the
 * left or the right rail when the finger lifts. That component owns the
 * physics; this one owns what the button opens.
 *
 * Tapped, it becomes the keyboard -- and the keyboard does not float. It is a
 * keyboard, so it sits where a keyboard sits: across the bottom of the pane,
 * over the last rows, in the seat the ordinary dock has on every other pane.
 * There is nothing above it to grab, no chevrons and no second dismissal. It
 * was briefly given all three, and a header row of controls over an on-screen
 * keyboard reads as neither a keyboard nor a dock: the way out of it is the
 * keyboard's own toggle, which is where the reader has just been looking, and
 * the button comes back exactly where they left it.
 */
export interface EditorControlsProps {
  /** The keyboard is out, rather than the button that opens it. */
  expanded: boolean;
  onExpand: () => void;
  /**
   * Where the reader has parked the button, in points from its resting corner.
   *
   * Owned by the screen rather than by this component so that the position
   * outlives a trip out of the editor and back: leaving nvim unmounts this,
   * and a reader who moved the button should not have to move it again. `x` is
   * zero on the right rail and negative on the left; `y` is negative upwards.
   */
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
  /** Clearance at the top of the pane -- the header the button must not reach. */
  topInset?: number;
  /** Clearance at the bottom: the safe area, and anything standing in it. */
  bottomInset?: number;
  /**
   * The system keyboard's height as it animates, negative while it is up.
   *
   * The panel rides it rather than the terminal doing so, and that is a
   * deliberate choice rather than a convenience: shrinking the terminal for the
   * phone's keyboard is a grid resize, and a grid resize on an editor is a
   * `SIGWINCH` and a full repaint for the ten seconds it takes to paste a line
   * -- twice, once on the way up and once on the way down. What the reader
   * needs to see while typing is the field they are typing into, and the field
   * travels with this.
   */
  keyboardOffset?: SharedValue<number>;
  /** The panel's body: the keyboard, the keys, the composer. */
  children?: ReactNode;
  /** Whether the pane can be typed into at all. */
  disabled?: boolean;
}

export function EditorControls({
  expanded,
  onExpand,
  offsetX,
  offsetY,
  topInset = 0,
  bottomInset = 0,
  keyboardOffset,
  children,
  disabled = false,
}: EditorControlsProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();

  /**
   * The keyboard's own travel, and the only thing that moves the panel.
   *
   * The safe area is subtracted because the phone's keyboard covers it: the
   * panel already pads for it, and translating by the raw height would leave
   * that padding as a band of terminal between the keys and the keyboard --
   * which is what the ordinary dock's own animated style has always avoided,
   * by exactly this arithmetic.
   */
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, -(keyboardOffset?.value ?? 0) - bottomInset) }],
  }));

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Hidden rather than unmounted while the keyboard is out, so the layer
          keeps the pane's measurement and the rail the button was parked on. */}
      <FloatingHandle
        offsetX={offsetX}
        offsetY={offsetY}
        topInset={topInset}
        bottomInset={bottomInset}
        hidden={expanded}
        onPress={onExpand}
        accessibilityLabel={t`Show the editor keyboard`}
        accessibilityHint={t`Opens the keyboard, the editor keys and the composer over this editor. Drag to move.`}
        moveLabel={t`Move the editor controls`}>
        {/* `primary`, not `text`. This handle floats over the *pane*, whose
            background is the terminal's, while `text` is the colour of the
            app's own surfaces -- so in light mode it drew a dark glyph on a
            dark editor and the control read as a blank grey disc. The other
            controls that float over the pane (`paneEntries` in its transparent
            tray) already use `primary` for the same reason, and a custom pack's
            primary is contrast-checked against its surfaces. */}
        <KeyboardIcon size={20} color={theme.colors.primary} />
      </FloatingHandle>
      {expanded ? (
        <Animated.View pointerEvents="box-none" style={[styles.panelAnchor, panelStyle]}>
          <GlassChrome
            face="floating"
            entering={riseIn()}
            exiting={fadeOutDown('short')}
            style={[styles.panel, { paddingBottom: Math.max(bottomInset, 10) }]}>
            <View
              // The body is inert while the pane cannot take input -- a
              // reconnecting SSH shell, a pane the gateway has not answered for.
              pointerEvents={disabled ? 'none' : 'auto'}
              style={[styles.panelBody, disabled ? styles.panelBodyDisabled : null]}>
              {children}
            </View>
          </GlassChrome>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * The panel's own fade, for the rows inside it that come and go -- the composer
 * arriving over the keys, the entry button leaving. Exported so the two
 * workspaces animate the same swap the same way without importing `motion`
 * twice over for it.
 */
export const editorPanelRow = {
  entering: fadeIn('micro'),
  exiting: fadeOutDown('short'),
};

const styles = StyleSheet.create({
  /** Where a keyboard goes: the full width of the pane, along the bottom of it. */
  panelAnchor: {
    position: 'absolute',
    zIndex: 12,
    elevation: 12,
    left: 0,
    right: 0,
    bottom: 0,
  },
  /** The ordinary dock's own shape, because this stands in the dock's seat. */
  panel: {
    paddingTop: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: appChrome.radius.composerDock,
    borderTopRightRadius: appChrome.radius.composerDock,
    borderCurve: 'continuous',
    boxShadow: appChrome.shadow.composerDock,
  },
  panelBody: {
    gap: 8,
  },
  panelBodyDisabled: {
    opacity: appChrome.opacity.disabled,
  },
});
