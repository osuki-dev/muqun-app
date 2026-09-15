import { ThemeProvider as OsukiThemeProvider, useThemeMode } from '@osuki-dev/ui';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useThemePalette } from '@/hooks/use-theme-pack';
import { useThemeLibrary } from '@/stores/theme-library';
import {
  resolveCandidateTheme,
  selectEffectiveCustomTheme,
  type EffectiveCustomTheme,
} from '@/theme/candidate-theme';
import type { ThemeManifest } from '@/theme/schema';
import type { InstalledTheme } from '@/theme/repository';

/**
 * The theme being looked at, for the part of the tree that is looking at it.
 *
 * `null` -- the value outside any preview -- is not "no theme": it is "ask the
 * library what the app is wearing", which is what every consumer of this did
 * for itself before there was a candidate to consider.
 */
const CandidateThemeContext = createContext<EffectiveCustomTheme | null>(null);

/**
 * Dress a subtree in a theme that is not the applied one.
 *
 * The preview route used to draw a candidate's two cards by hand on a screen
 * wearing the applied theme, so the answer to "what does this theme look like"
 * was two postage stamps surrounded by the theme it was being compared with.
 * Everything around those cards -- the floor, the wallpaper, the header, the
 * back button, the bar at the bottom and the button that applies the thing --
 * now comes from the candidate too.
 *
 * Two providers, because the app's colour has two owners. The kit's tokens are
 * what `useThemeTokens()` returns and therefore what every ordinary control is
 * painted with; the custom-theme context is what the artwork, material and
 * surface-opacity consumers read, none of which the kit knows about. Nesting
 * the kit's provider is supported (it is plain React context) and the mode is
 * passed straight through from the provider above, so the reader's system /
 * light / dark preference is the one thing this does not override -- a preview
 * that quietly flipped to light would be previewing the wrong half of the pack.
 */
export function CandidateThemeProvider({
  manifest,
  assets,
  installationId,
  appearance,
  children,
}: {
  manifest: ThemeManifest;
  /** App-owned files already staged for this candidate, never author URLs. */
  assets?: Record<string, string>;
  /** Set when the candidate is already installed, so its own preferences apply. */
  installationId?: string;
  /** Unsaved preview preferences; never written to the global library. */
  appearance?: InstalledTheme;
  children: ReactNode;
}) {
  const installed = useThemeLibrary((state) =>
    installationId ? state.library.themes.find((entry) => entry.id === installationId) : undefined
  );
  const theme = useMemo(
    () => resolveCandidateTheme(manifest, assets, installed ?? appearance),
    [manifest, assets, installed, appearance]
  );
  const value = useMemo<EffectiveCustomTheme>(() => ({ theme, assets }), [theme, assets]);
  const { mode } = useThemeMode();
  const palette = useThemePalette(theme);
  return (
    <CandidateThemeContext.Provider value={value}>
      <OsukiThemeProvider mode={mode} theme={palette}>
        {children}
      </OsukiThemeProvider>
    </CandidateThemeContext.Provider>
  );
}

/**
 * The custom theme the app is *wearing*, whatever is being previewed around it.
 *
 * The store read every artwork consumer used to carry its own copy of, named
 * once so that the surfaces which must ignore a candidate share it with the
 * surfaces which must not. The launch overlay and the lock screen are the
 * first kind: they render above the router, before any route exists, so they
 * can never be inside `CandidateThemeProvider` -- and "cannot be today" is a
 * weaker guarantee than asking for the applied theme by name, which is what
 * they do.
 */
export function useAppliedCustomTheme(): EffectiveCustomTheme {
  const active = useThemeLibrary((state) => state.active);
  const assets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  return useMemo(() => ({ theme: active, assets }), [active, assets]);
}

/**
 * The custom theme this component should draw, and its installed files.
 *
 * Outside a preview this is exactly the applied theme above, so nothing about
 * the running app changes. Inside one, it is the candidate. Consumers that
 * need only one of the two still take the pair: a manifest without its assets
 * resolves an asset id to nothing.
 */
export function useEffectiveCustomTheme(): EffectiveCustomTheme {
  const candidate = useContext(CandidateThemeContext);
  const applied = useAppliedCustomTheme();
  return useMemo(
    () => selectEffectiveCustomTheme(candidate, applied.theme, applied.assets),
    [candidate, applied]
  );
}
