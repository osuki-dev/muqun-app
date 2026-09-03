/**
 * What the two-tap unpair control shows, and -- the reason this file exists --
 * what it refuses to do while the gateway is still being asked.
 *
 * Unpairing is not a local delete. The record is forgotten only after the
 * gateway has been asked to drop this device's token, and a gateway that is
 * gone takes seconds to say nothing at all. For that whole stretch the control
 * is mid-flight: it has to say so, and it has to stop accepting taps, because
 * the removal behind it is not idempotent from the reader's side -- a second
 * confirm would queue a second removal against a record that is already on its
 * way out, and a Cancel would disarm a button whose work is already running and
 * cannot be called back.
 *
 * Both of those are one-line mistakes to make in JSX and invisible in review:
 * `disabled` on the destructive button and not on the one beside it reads as
 * finished work. Stating the mapping once, here, is what lets a test hold it.
 */

/** The control's state: armed by the first tap, working after the second. */
export type UnpairState = {
  /** The first tap arms; until then there is only the single Unpair button. */
  armed: boolean;
  /** The second tap starts the revoke, which the caller awaits. */
  pending: boolean;
};

/** How one of the two armed buttons should be rendered. */
export type UnpairButton = {
  /** Drives the `disabled` prop and `accessibilityState.disabled` together. */
  disabled: boolean;
  /** The 0.7 opacity that makes a disabled button look disabled. */
  dimmed: boolean;
};

export type UnpairView = {
  /** Whether the armed pair is mounted at all, rather than the single button. */
  showArmedPair: boolean;
  confirm: UnpairButton & {
    /**
     * `accessibilityState.busy`. A screen reader lands on this button while the
     * revoke is in flight and must not be told the work is merely unavailable.
     */
    busy: boolean;
    /** The spinner replaces the trash icon; they are never shown together. */
    icon: 'trash' | 'spinner';
    /**
     * Which of the two labels the button carries. A token, not the text: the
     * words themselves stay in the component, inside the macro that translates
     * them.
     */
    phase: 'idle' | 'working';
  };
  cancel: UnpairButton;
};

/**
 * Nothing in the armed pair is interactive while the revoke is in flight. Both
 * buttons take the same `pending`, deliberately: the asymmetry -- a live Cancel
 * beside a spinning Unpair -- is the bug this shape exists to make impossible.
 */
export function unpairView({ armed, pending }: UnpairState): UnpairView {
  return {
    showArmedPair: armed,
    confirm: {
      disabled: pending,
      dimmed: pending,
      busy: pending,
      icon: pending ? 'spinner' : 'trash',
      phase: pending ? 'working' : 'idle',
    },
    cancel: { disabled: pending, dimmed: pending },
  };
}

/**
 * Whether a confirm tap should start a removal. `disabled` already stops the
 * pointer, but a queued gesture that lands in the same frame as the state
 * change does not go through `disabled` at all, so the guard is stated in the
 * handler too rather than trusted to the prop.
 */
export function acceptsConfirm({ armed, pending }: UnpairState): boolean {
  return armed && !pending;
}

/** Cancel disarms, but never out from under a revoke that is already running. */
export function acceptsCancel({ armed, pending }: UnpairState): boolean {
  return armed && !pending;
}
