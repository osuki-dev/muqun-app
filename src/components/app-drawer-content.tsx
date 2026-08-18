import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { type Href, usePathname, useRouter } from 'expo-router';
import { ChevronRight, LayoutGrid, ScanLine, Settings } from 'lucide-react-native';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { isDrawerPermanent } from '@/constants/navigation';

/**
 * Navigation only. The home screen already lists the servers, so repeating them
 * here was redundant; the drawer is for moving between the app's top-level
 * places -- servers, pairing, settings -- not for picking a server.
 *
 * Unreachable while `HOME_DRAWER_ENABLED` is false (card #664): `Servers` was
 * the screen it opened from, and `Pair a server` and `Settings` are now the two
 * controls in the home header. Kept intact so flipping the switch back restores
 * a working panel rather than an empty one.
 */
export function AppDrawerContent({ navigation }: DrawerContentComponentProps) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();


  const router = useRouter();
  const theme = useThemeTokens();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const permanent = isDrawerPermanent(width);

  function closeDrawer() {
    if (!permanent) navigation.closeDrawer();
  }

  function go(href: Href) {
    closeDrawer();
    router.push(href);
  }

  const items: { key: string; label: string; detail: string; icon: typeof LayoutGrid; href: Href; active: boolean }[] = [
    {
      key: 'servers',
      label: t`Servers`,
      detail: t`Your paired gateways`,
      icon: LayoutGrid,
      href: '/' as Href,
      active: pathname === '/' || pathname.startsWith('/servers'),
    },
    {
      key: 'pair',
      label: t`Pair a server`,
      detail: t`Scan a gateway QR`,
      icon: ScanLine,
      href: '/explore' as Href,
      active: pathname.startsWith('/explore'),
    },
    {
      key: 'settings',
      label: t`Settings`,
      detail: t`Appearance, terminal, security`,
      icon: Settings,
      href: '/settings' as Href,
      active: pathname.startsWith('/settings'),
    },
  ];

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.safeArea, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.header}>
        <View style={styles.flexOne}>
          <Text variant="heading">{t`Muqun`}</Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Your agents, anywhere.</Trans>
          </Text>
        </View>
      </View>

      <View style={styles.nav}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <PressableScale
              key={item.key}
              accessibilityLabel={item.label}
              onPress={() => go(item.href)}
              style={[
                styles.navItem,
                {
                  backgroundColor: item.active
                    ? theme.colors.primarySubtle
                    : theme.colors.surfaceRaised,
                },
              ]}>
              <View
                style={[
                  styles.navIcon,
                  { backgroundColor: item.active ? theme.colors.primary : theme.colors.background },
                ]}>
                <Icon
                  size={18}
                  color={item.active ? theme.colors.onPrimary : theme.colors.textMuted}
                  strokeWidth={2}
                />
              </View>
              <View style={styles.flexOne}>
                <Text variant="bodySmall" numberOfLines={1}>
                  {item.label}
                </Text>
                <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                  {item.detail}
                </Text>
              </View>
              <ChevronRight size={18} color={theme.colors.textMuted} />
            </PressableScale>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 20,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nav: {
    gap: 10,
  },
  navItem: {
    minHeight: 60,
    borderRadius: 18,
    borderCurve: 'continuous',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: {
    flex: 1,
  },
});
