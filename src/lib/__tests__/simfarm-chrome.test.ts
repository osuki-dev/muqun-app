// The chrome's table: one button, one menu, and what each tap does to them.
// No component, no gesture and no clock -- the clock is gone with the rows
// it used to put away.
import { describe, expect, test } from 'bun:test';

import { type SimfarmDevice } from '@/lib/simfarm';
import {
  recallSimfarmHandle,
  rememberSimfarmHandle,
  SIMFARM_CHROME_CLOSED,
  SIMFARM_MENU_GAP,
  SIMFARM_MENU_PREFERRED_HEIGHT,
  simfarmBackPress,
  simfarmChromeNext,
  simfarmChromeTransition,
  simfarmDeviceTouchable,
  simfarmMenuItems,
  simfarmMenuPlacement,
  type SimfarmChromeEvent,
  type SimfarmChromeState,
} from '@/lib/simfarm-chrome';

function after(...events: SimfarmChromeEvent[]): SimfarmChromeState {
  return events.reduce(simfarmChromeNext, SIMFARM_CHROME_CLOSED);
}

describe('the button and the menu', () => {
  test('starts as the button alone', () => {
    expect(SIMFARM_CHROME_CLOSED).toEqual({ menu: false, picking: false, typing: false });
  });

  test('a tap on the button opens the menu on its actions, and another closes it', () => {
    expect(after('button')).toEqual({ menu: true, picking: false, typing: false });
    expect(after('button', 'button')).toEqual(SIMFARM_CHROME_CLOSED);
  });

  test('a tap outside closes it', () => {
    expect(after('button', 'outside')).toEqual(SIMFARM_CHROME_CLOSED);
  });

  test('the header flips between the actions and the device list', () => {
    expect(after('button', 'header').picking).toBe(true);
    expect(after('button', 'header', 'header').picking).toBe(false);
    // And does nothing when there is no menu to flip.
    expect(after('header')).toEqual(SIMFARM_CHROME_CLOSED);
  });

  test('closing the menu forgets which page it was on', () => {
    expect(after('button', 'header', 'button')).toEqual(SIMFARM_CHROME_CLOSED);
    expect(after('button', 'header', 'outside')).toEqual(SIMFARM_CHROME_CLOSED);
  });

  test('choosing a device or pressing a key closes the menu', () => {
    expect(after('button', 'header', 'chose')).toEqual(SIMFARM_CHROME_CLOSED);
    expect(after('button', 'acted')).toEqual(SIMFARM_CHROME_CLOSED);
  });

  test('offering the list opens straight onto it, once', () => {
    expect(after('offer')).toEqual({ menu: true, picking: true, typing: false });
    // A second report of the same thing changes nothing the reader did.
    const open = after('offer');
    expect(simfarmChromeNext(open, 'offer')).toEqual(open);
  });
});

describe('the composer', () => {
  test("comes out in the menu's place, and the menu closes", () => {
    expect(after('button', 'keyboard')).toEqual({ menu: false, picking: false, typing: true });
  });

  test('is put away on its own event, and nothing else', () => {
    expect(after('button', 'keyboard', 'composed')).toEqual(SIMFARM_CHROME_CLOSED);
    expect(after('button', 'keyboard', 'outside').typing).toBe(true);
  });

  test('does not pause the device: the app above it is still the app', () => {
    expect(simfarmDeviceTouchable(after('button', 'keyboard'))).toBe(true);
  });
});

describe('what reaches the device', () => {
  test('everything while the menu is away, nothing while it is out', () => {
    expect(simfarmDeviceTouchable(SIMFARM_CHROME_CLOSED)).toBe(true);
    expect(simfarmDeviceTouchable(after('button'))).toBe(false);
    expect(simfarmDeviceTouchable(after('offer'))).toBe(false);
    expect(simfarmDeviceTouchable(after('button', 'outside'))).toBe(true);
  });
});

describe('the hardware back', () => {
  test('closes an open menu and keeps the preview', () => {
    const result = simfarmBackPress(after('button', 'header'));
    expect(result.closesPreview).toBe(false);
    expect(result.state).toEqual(SIMFARM_CHROME_CLOSED);
  });

  test('closes the preview when there is no menu', () => {
    expect(simfarmBackPress(SIMFARM_CHROME_CLOSED).closesPreview).toBe(true);
    // The composer is not a menu: back with it out is back as today.
    expect(simfarmBackPress(after('button', 'keyboard')).closesPreview).toBe(true);
  });
});

describe('what the menu offers', () => {
  const device = (buttons: string[], text: boolean): SimfarmDevice => ({
    id: 'd',
    name: 'Phone',
    kind: 'ios',
    booted: true,
    capabilities: { video: ['jpeg'], text, buttons, boot: true },
  });

  test('the three navigation keys the device declared, in hand order, then the composer', () => {
    expect(
      simfarmMenuItems(device(['lock', 'app_switch', 'back', 'home', 'volume_up'], true), {
        closable: true,
      })
    ).toEqual(['home', 'back', 'app_switch', 'keyboard', 'close']);
  });

  test('a key the device does not have is not there, nor a composer it cannot type into', () => {
    expect(simfarmMenuItems(device(['home'], false), { closable: true })).toEqual([
      'home',
      'close',
    ]);
  });

  test('no device is the picker and the way out, and the Pad column has no way out', () => {
    expect(simfarmMenuItems(null, { closable: true })).toEqual(['close']);
    expect(simfarmMenuItems(null, { closable: false })).toEqual([]);
  });
});

describe('where the menu goes', () => {
  const stage = { width: 402, height: 874 };
  const insets = { top: 59, bottom: 34 };
  const button = (x: number, y: number) => ({ x, y, width: 46, height: 46 });

  test('hangs off the rail the button is parked on', () => {
    const right = simfarmMenuPlacement(button(342, 400), stage, insets);
    expect(right.right).toBe(402 - 342 - 46);
    expect(right.left).toBeUndefined();
    const left = simfarmMenuPlacement(button(14, 400), stage, insets);
    expect(left.left).toBe(14);
    expect(left.right).toBeUndefined();
  });

  test('opens below a button near the top, with the room down to the home indicator', () => {
    const placed = simfarmMenuPlacement(button(342, 80), stage, insets);
    expect(placed.top).toBe(80 + 46 + SIMFARM_MENU_GAP);
    expect(placed.bottom).toBeUndefined();
    expect(placed.maxHeight).toBe(874 - 34 - (80 + 46 + SIMFARM_MENU_GAP));
  });

  test('opens above a button near the bottom, clear of the cutout', () => {
    const placed = simfarmMenuPlacement(button(342, 780), stage, insets);
    expect(placed.bottom).toBe(874 - 780 + SIMFARM_MENU_GAP);
    expect(placed.top).toBeUndefined();
    expect(placed.maxHeight).toBe(780 - SIMFARM_MENU_GAP - 59);
  });

  test('prefers below while the whole menu fits there, even with more room above', () => {
    // Just past the middle: more room above, but enough below for the menu.
    const y = 874 - 34 - SIMFARM_MENU_PREFERRED_HEIGHT - SIMFARM_MENU_GAP - 46;
    expect(simfarmMenuPlacement(button(342, y), stage, insets).top).toBeDefined();
    expect(simfarmMenuPlacement(button(342, y + 1), stage, insets).bottom).toBeDefined();
  });

  test('never reports negative room', () => {
    const placed = simfarmMenuPlacement(button(342, 860), { width: 402, height: 900 }, insets);
    expect(placed.maxHeight).toBeGreaterThanOrEqual(0);
  });
});

describe('the transition', () => {
  test('drops in over the dropdown token by default', () => {
    expect(simfarmChromeTransition(false)).toEqual({ duration: 'dropdown', slide: true });
  });

  test('with motion reduced it fades in place, and still fades', () => {
    expect(simfarmChromeTransition(true)).toEqual({ duration: 'micro', slide: false });
  });
});

describe('memory', () => {
  test('the button starts at its corner, and is then found where it was left', () => {
    expect(recallSimfarmHandle()).toBeNull();
    rememberSimfarmHandle({ x: -320, y: -200 });
    expect(recallSimfarmHandle()).toEqual({ x: -320, y: -200 });
    rememberSimfarmHandle(null);
    expect(recallSimfarmHandle()).toBeNull();
  });
});
