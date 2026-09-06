/**
 * The chrome over the simulator's picture: one floating button, and the menu
 * it opens.
 *
 * "Chrome" used to be two rows that were not the device -- a pill naming it
 * at the top with the picker and the close button, and a key row along the
 * bottom -- plus a slim handle in each edge band to put them away, and a
 * clock that put them away on its own. That is gone. The picture fills the
 * phone from the very top edge, so there is no band for a handle to live in,
 * and what floats over the app under test is the app's one floating button
 * (`FloatingHandle`): dragged anywhere, parked on a rail, remembered for the
 * process. Everything the rows did is behind a tap on it.
 *
 * ## The rule for what touches the device
 *
 * **A touch on the picture is the device's. The button and its menu are the
 * only things that are not.**
 *
 * The obvious alternative -- tap the picture to bring the controls up -- was
 * rejected with the rows and stays rejected, because there is no way to tell
 * that tap from a tap meant for the app under test; a tap the device silently
 * missed is the worst thing this preview can do. The button is drawn over the
 * picture and takes the press, so nothing under it is asked. While the menu
 * is open, so is a backdrop under it: a tap anywhere outside the menu closes
 * it and reaches nothing else, which is what "the menu pauses the device's
 * touches" means precisely -- one tap to put the menu away, and the next one
 * is the device's again.
 *
 * ## Why the state is a table
 *
 * Three booleans, five things that change them, and a hardware back key that
 * means two different things depending on the first boolean. That is the kind
 * of rule that is one sentence in a test and three `if`s in a component, so
 * it is here, pure, with the anchoring arithmetic beside it.
 */
import { type HandlePoint } from '@/lib/floating-handle';
import { type SimfarmDevice } from '@/lib/simfarm';
import { type SimfarmButton } from '@/lib/simfarm-protocol';

export interface SimfarmChromeState {
  /** The menu is open under the button, with the backdrop out. */
  menu: boolean;
  /** The menu is showing the device list rather than the actions. */
  picking: boolean;
  /** The text composer is out along the bottom, in the button's place. */
  typing: boolean;
}

/** Nothing but the button. */
export const SIMFARM_CHROME_CLOSED: SimfarmChromeState = {
  menu: false,
  picking: false,
  typing: false,
};

/**
 * What can happen to the chrome.
 *
 * - `button`: the floating button was tapped. Opens the menu on its actions,
 *   or closes it if it was open.
 * - `outside`: a tap on the backdrop. Closes the menu.
 * - `header`: the device name at the top of the menu was tapped. Flips the
 *   menu between its actions and the device list.
 * - `offer`: nothing is attached and the list is the only useful thing to
 *   show; opens the menu straight onto the device list. Idempotent, so a
 *   stream that reports "picking" twice does not reopen a menu the reader
 *   closed.
 * - `chose`: a device row was pressed. The menu closes; the picture is the
 *   acknowledgement.
 * - `acted`: a key was pressed -- home, back, the app switcher. The menu
 *   closes so the device's answer can be seen.
 * - `keyboard`: the composer was asked for. The menu closes and the composer
 *   comes out where the button was.
 * - `composed`: the composer was put away. The button comes back.
 */
export type SimfarmChromeEvent =
  | 'button'
  | 'outside'
  | 'header'
  | 'offer'
  | 'chose'
  | 'acted'
  | 'keyboard'
  | 'composed';

export function simfarmChromeNext(
  state: SimfarmChromeState,
  event: SimfarmChromeEvent
): SimfarmChromeState {
  switch (event) {
    case 'button':
      return state.menu ? { ...state, menu: false, picking: false } : { ...state, menu: true };
    case 'outside':
    case 'chose':
    case 'acted':
      return { ...state, menu: false, picking: false };
    case 'header':
      return state.menu ? { ...state, picking: !state.picking } : state;
    case 'offer':
      return { ...state, menu: true, picking: true };
    case 'keyboard':
      return { ...state, menu: false, picking: false, typing: true };
    case 'composed':
      return { ...state, typing: false };
  }
}

/**
 * Whether a touch on the picture reaches the device.
 *
 * Only the menu stands in the way. The composer does not: it is a strip along
 * the bottom, and the app under test above it is still the app under test --
 * a reader typing a search term wants to tap the result.
 */
export function simfarmDeviceTouchable(state: SimfarmChromeState): boolean {
  return !state.menu;
}

/**
 * Android's hardware back, which is this screen's and is never sent to the
 * emulator: it closes the menu if there is one to close, and otherwise
 * closes the preview. The emulator's own Back is an item in the menu.
 */
export function simfarmBackPress(state: SimfarmChromeState): {
  state: SimfarmChromeState;
  closesPreview: boolean;
} {
  if (state.menu) return { state: simfarmChromeNext(state, 'outside'), closesPreview: false };
  return { state, closesPreview: true };
}

/**
 * What the menu offers, in the order a hand expects it, under the device
 * name that is its header and the picker.
 *
 * Only what the device declared -- the backends differ a great deal and a key
 * that does nothing is worse than a key that is not there -- and only the
 * three navigation keys a phone has. The lock key and the volume keys are
 * real capabilities and would be three more rows for the sake of a case
 * nobody previews. The composer needs a device that takes text; closing
 * needs a host with something to close, which the Pad column is not.
 */
export type SimfarmMenuItem = 'home' | 'back' | 'app_switch' | 'keyboard' | 'close';

const OFFERED_KEYS: (SimfarmButton & SimfarmMenuItem)[] = ['home', 'back', 'app_switch'];

export function simfarmMenuItems(
  device: SimfarmDevice | null,
  options: { closable: boolean }
): SimfarmMenuItem[] {
  const items: SimfarmMenuItem[] = [];
  if (device !== null) {
    for (const key of OFFERED_KEYS) {
      if (device.capabilities.buttons.includes(key)) items.push(key);
    }
    if (device.capabilities.text) items.push('keyboard');
  }
  if (options.closable) items.push('close');
  return items;
}

/** A rectangle in the stage's coordinates. */
export interface SimfarmRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the menu card goes, as the absolute-position style the stage applies. */
export interface SimfarmMenuPlacement {
  /** Set when the card hangs off the button's left edge; else `right` is. */
  left?: number;
  right?: number;
  /** Set when the card opens below the button; else `bottom` is. */
  top?: number;
  bottom?: number;
  /** The room the card has in the direction it opens. */
  maxHeight: number;
}

/** Between the button and the card, and between the card and the screen's ends. */
export const SIMFARM_MENU_GAP = 8;
/**
 * How much room below the button is enough to open downwards regardless of
 * how much there is above: the header, the three keys and two more rows.
 */
export const SIMFARM_MENU_PREFERRED_HEIGHT = 300;

/**
 * Anchors the menu to the button that opened it.
 *
 * Sideways, the card lines up with the button's outer edge -- the rail it is
 * parked on -- and grows inward, so a button on the left rail has a menu
 * reading from the left and one on the right has it reading from the right,
 * and neither can be pushed off the screen by the other side's width.
 * Vertically it opens downwards when there is room for the whole menu below
 * the button, which is where a menu under a button is expected, and
 * otherwise whichever way has more room. The insets are kept clear at both
 * ends: a menu opening under a camera cutout or over a home indicator is a
 * menu with a row nobody can read.
 */
export function simfarmMenuPlacement(
  button: SimfarmRect,
  stage: { width: number; height: number },
  insets: { top: number; bottom: number } = { top: 0, bottom: 0 }
): SimfarmMenuPlacement {
  const centreX = button.x + button.width / 2;
  const horizontal =
    centreX < stage.width / 2
      ? { left: button.x }
      : { right: Math.max(0, stage.width - button.x - button.width) };
  const roomBelow = Math.max(
    0,
    stage.height - insets.bottom - (button.y + button.height + SIMFARM_MENU_GAP)
  );
  const roomAbove = Math.max(0, button.y - SIMFARM_MENU_GAP - insets.top);
  const below = roomBelow >= SIMFARM_MENU_PREFERRED_HEIGHT || roomBelow >= roomAbove;
  const vertical = below
    ? { top: button.y + button.height + SIMFARM_MENU_GAP, maxHeight: roomBelow }
    : { bottom: stage.height - button.y + SIMFARM_MENU_GAP, maxHeight: roomAbove };
  return { ...horizontal, ...vertical };
}

/**
 * How the menu arrives.
 *
 * With motion reduced it does not travel at all: it fades where it is, over
 * the shortest token, which is the substitute the platform guidelines ask for
 * -- a crossfade is not a movement -- and is deliberately not the instant
 * jump `ReduceMotion.System` would otherwise make of the timing. A menu that
 * blinked into existence with no transition reads as a glitch on a screen
 * that is a live picture.
 */
export function simfarmChromeTransition(reduceMotion: boolean): {
  duration: 'micro' | 'dropdown';
  slide: boolean;
} {
  return reduceMotion ? { duration: 'micro', slide: false } : { duration: 'dropdown', slide: true };
}

/** Where the reader last left the button, for the life of the app. */
let rememberedHandle: HandlePoint | null = null;

/**
 * Where the button should start.
 *
 * Remembered for the process rather than persisted: a reader who dragged the
 * button off a tab bar and reopens the preview a minute later finds it where
 * they put it, and a reader who opens the app tomorrow finds it at its
 * resting corner, which is the one place it is always easy to find. `null`
 * is that corner -- the offsets are zero and `FloatingHandle` does the rest.
 */
export function recallSimfarmHandle(): HandlePoint | null {
  return rememberedHandle;
}

export function rememberSimfarmHandle(at: HandlePoint | null): void {
  rememberedHandle = at;
}
