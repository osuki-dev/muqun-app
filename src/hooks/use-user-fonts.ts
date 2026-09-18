/**
 * Registering the reader's fonts, once, before the app draws anything.
 *
 * The app's first frame is the one frame a font swap cannot fix afterwards, and
 * on Android it is worse than cosmetic. `react-native-enriched-markdown`
 * resolves a family through `ReactFontManager` and memoises the answer in a
 * process-global `typefaceCache` (`TextPaintExtensions.kt:21`) that has no
 * invalidation: whatever `MuqunUserMono` resolves to the first time a markdown
 * view asks for it is what it resolves to for the rest of the process. Ask
 * before `Font.loadAsync` has run and the cache is poisoned with the system
 * font, and every code block in every transcript is drawn in it until the
 * reader force-quits the app.
 *
 * So the router does not mount until this has settled. That is the pattern the
 * Expo font docs prescribe for exactly this reason -- hold the layout, let the
 * native splash stay up -- and here it also means the cache's first question is
 * asked after its answer exists.
 *
 * "Settled" is not "succeeded". A font that will not register, a file that is
 * gone, a filesystem that will not answer: none of those is a reason to leave a
 * reader looking at a splash screen, so the wait is capped and the app opens on
 * the system font with the setting kept. What went wrong is recorded rather
 * than shouted -- a toast on launch, before the reader has done anything, is
 * the app complaining about its own state -- and the Font sheet is where it is
 * said, next to the row it is about.
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import type { MarkdownFonts } from '@/lib/markdown-style';
import { useAppSettings } from '@/stores/app-settings';
import {
  FONT_SLOT_IDS,
  registerUserFonts,
  slotFontFamily,
  type FontSlotId,
  type UserFontProblem,
} from '@/theme/user-fonts';

/**
 * How long the app will wait on the splash for a font, in milliseconds.
 *
 * Registration is a keychain read, a `stat` and one `Typeface.createFromFile`
 * (Android) or `CTFontManagerRegisterFontsForURL` (iOS) per slot. On a warm
 * device that is a few milliseconds; on a cold start with a 20 MB Han face on
 * slow storage it is a good deal more, and the whole point of holding the frame
 * is to let that finish.
 *
 * 2500 is above any measured registration and below the point where a launch
 * reads as a hang. It is also close to what the launch overlay is showing
 * anyway -- the brand mark holds for `micro + long + medium` -- so in the
 * ordinary case the reader waits for nothing at all: the fonts land inside the
 * animation that was already playing.
 */
export const USER_FONT_REGISTRATION_TIMEOUT_MS = 2500;

/** Whether a slot is drawn in the reader's font, and why not when it is not. */
export interface UserFontStatus {
  /** Registration has finished or been given up on. The router waits for this. */
  settled: boolean;
  /** One entry per slot that could not be registered. Empty is the normal case. */
  problems: Partial<Record<FontSlotId, UserFontProblem>>;
  /** Slots that gave up rather than failed: the cap above ran out first. */
  timedOut: boolean;
}

/**
 * What launch registration found, for the one screen that should say so.
 *
 * A store rather than a return value because the reader is not looking at the
 * settings sheet when this runs, and the answer has to survive until they are.
 */
export const useUserFontStatus = create<
  UserFontStatus & { settle: (next: Partial<UserFontStatus>) => void }
>((set) => ({
  settled: false,
  problems: {},
  timedOut: false,
  settle: (next) => set({ settled: true, ...next }),
}));

/** Whether a slot registered cleanly, for a row that wants to say it did not. */
export function useUserFontProblem(slot: FontSlotId): UserFontProblem | undefined {
  return useUserFontStatus((state) => state.problems[slot]);
}

/**
 * Hydrate the settings, register whatever fonts they name, and say when the
 * app may draw.
 *
 * Called once, from the root layout. Returns `false` for exactly as long as the
 * router should not be mounted.
 *
 * The settings hydration is folded in here rather than left as its own effect
 * because the two are one sentence: the fonts to register are a setting, so
 * reading the setting is the first half of registering them, and running them
 * as two independent effects is how the registration would race the read it
 * depends on.
 */
export function useUserFontsReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    /** The cap. Cleared on the happy path so a settled launch has no timer left. */
    let timer: ReturnType<typeof setTimeout> | null = null;

    function open(status: Partial<UserFontStatus>) {
      if (!active) return;
      active = false;
      if (timer) clearTimeout(timer);
      useUserFontStatus.getState().settle(status);
      setReady(true);
    }

    timer = setTimeout(() => open({ timedOut: true }), USER_FONT_REGISTRATION_TIMEOUT_MS);

    void (async () => {
      try {
        await useAppSettings.getState().hydrate();
        const { interfaceFont, monoFont } = useAppSettings.getState();
        const slots = { interface: interfaceFont, mono: monoFont } as const;
        // The overwhelmingly common case, and it must cost nothing: a reader
        // who has never added a font waits on no filesystem and no timer.
        if (FONT_SLOT_IDS.every((id) => slots[id].kind !== 'file')) {
          open({});
          return;
        }
        open({ problems: await registerUserFonts(slots) });
      } catch {
        // A hydrate that throws is a reader with no settings, not a reader with
        // no app. The store publishes its defaults either way and the app opens
        // on the system font.
        open({});
      }
    })();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return ready;
}

/**
 * The two families the markdown theme is built with, where the reader set them.
 *
 * One hook for the three surfaces that render markdown -- the chat transcript,
 * a tool card's output, the asset viewer's documents -- so none of them decides
 * for itself what "the reader's font" means. The object is memoised on the two
 * slots, because it goes straight into `useMemo` deps at every call site and a
 * fresh object each render would rebuild the whole markdown style on every
 * frame.
 */
export function useMarkdownFonts(): MarkdownFonts {
  const interfaceFont = useAppSettings((state) => state.interfaceFont);
  const monoFont = useAppSettings((state) => state.monoFont);
  return useMemo(
    () => ({
      prose: slotFontFamily(interfaceFont, 'interface'),
      mono: slotFontFamily(monoFont, 'mono'),
    }),
    [interfaceFont, monoFont]
  );
}
