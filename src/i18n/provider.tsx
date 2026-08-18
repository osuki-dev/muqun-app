import { I18nProvider as LinguiProvider, type TransRenderProps } from '@lingui/react';
import { useLocales } from 'expo-localization';
import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Text } from 'react-native';

import { useAppSettings } from '@/stores/app-settings';

import { activateLocale, i18n } from './index';
import { SOURCE_LOCALE, resolveLocale, type AppLocale } from './locale';

// Load the catalogs and select the source locale as this module is imported,
// which is before anything renders. Lingui needs an active locale to translate
// anything at all, and the real one cannot be known this early: it depends on
// the persisted preference, which arrives from SecureStore a few frames later.
// So the tree starts in English and moves, rather than starting with no
// catalog and having to guard every call site.
activateLocale(SOURCE_LOCALE);

/**
 * React Native has no bare text node, so every `<Trans>` would otherwise need
 * its own `<Text>` wrapper at the call site. Handing the provider a default
 * component keeps the markup honest: `<Trans>Retry</Trans>` where a string
 * belongs, and a real `<Text>` in the tree.
 *
 * Deliberately the plain RN `Text` rather than the design system's: this is the
 * fallback for translations rendered outside a styled context, and inheriting
 * a variant here would silently restyle them.
 */
function DefaultTextComponent(props: TransRenderProps) {
  return <Text>{props.children}</Text>;
}

/**
 * Resolve the locale and keep Lingui pointed at it.
 *
 * `useLocales()` re-renders when the user changes their language in system
 * settings, so a device switched from English to Chinese while Muqun is
 * backgrounded comes forward already translated -- as long as the user has not
 * pinned a language here, in which case their choice wins.
 */
export function useResolvedLocale(): AppLocale {
  const preference = useAppSettings((state) => state.language);
  const systemLocales = useLocales();

  return useMemo(() => {
    const tags = systemLocales.map((locale) => locale.languageTag);
    return resolveLocale(preference, tags);
  }, [preference, systemLocales]);
}

export function AppI18nProvider({ children }: { children: ReactNode }) {
  const locale = useResolvedLocale();

  // A layout effect, not a plain effect and not a call during render.
  //
  // Not during render: `i18n.activate` notifies Lingui's provider, which reads
  // it through `useSyncExternalStore`. Doing that while this component renders
  // is updating another component mid-render, and React says so out loud.
  //
  // Layout rather than passive: this runs after commit but before the frame is
  // drawn, so a language change never paints a frame of the old one.
  useLayoutEffect(() => {
    if (i18n.locale !== locale) activateLocale(locale);
  }, [locale]);

  return (
    <LinguiProvider i18n={i18n} defaultComponent={DefaultTextComponent}>
      {children}
    </LinguiProvider>
  );
}
