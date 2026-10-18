import { describe, expect, test } from 'bun:test';
import type { SharedValue } from 'react-native-reanimated';
import { createStore } from 'zustand/vanilla';

import { homeScrollFadeOpacity } from '../home-scroll-fade';
import { createLaunchHandoffState, launchEntryProgress } from '../launch-handoff';

function stoppedDriver(progress: number) {
  return { get: () => progress } as SharedValue<number>;
}

describe('launch handoff visibility', () => {
  test('a timed-out snap releases its unfinished clock and reveals the cover content', () => {
    const store = createStore(createLaunchHandoffState(false));
    const driver = stoppedDriver(0);
    store.getState().setRevealDriver(driver);
    store.getState().beginReveal();
    store.getState().markReady();
    const before = launchEntryProgress(driver.get(), store.getState().settled);
    expect(homeScrollFadeOpacity((1 - before) * 120, 120, 120)).toBe(0);

    // SplashOverlay's safety cap calls onHidden without completing the snap.
    store.getState().settle();
    expect(store.getState().driver).toBeNull();
    expect(store.getState().revealing).toBe(true);
    const after = launchEntryProgress(driver.get(), store.getState().settled);
    expect(after).toBe(1);
    expect(homeScrollFadeOpacity((1 - after) * 120, 120, 120)).toBe(1);

    // A late effect from the outgoing scene must not attach that clock again.
    store.getState().setRevealDriver(driver);
    expect(store.getState().driver).toBeNull();
  });

  test('web and Home mounted after launch are already visible without another reveal event', () => {
    const web = createStore(createLaunchHandoffState(true));
    expect(web.getState().revealing).toBe(true);
    expect(launchEntryProgress(-1, web.getState().settled)).toBe(1);

    const native = createStore(createLaunchHandoffState(false));
    native.getState().settle();
    expect(launchEntryProgress(-1, native.getState().settled)).toBe(1);
  });

  test('an active snap still drives the original eased entrance and cross-fade owns its clock', () => {
    const store = createStore(createLaunchHandoffState(false));
    const driver = stoppedDriver(0.5);
    store.getState().setRevealDriver(driver);
    store.getState().beginReveal();
    expect(store.getState().driver).toBe(driver);
    expect(launchEntryProgress(driver.get(), false)).toBe(0.75);
    store.getState().setRevealDriver(null);
    expect(launchEntryProgress(-1, false)).toBe(-1);
    expect(launchEntryProgress(1, false)).toBe(1);
  });
});
