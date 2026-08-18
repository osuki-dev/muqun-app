import { useThemeTokens } from '@osuki-dev/ui';
import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';

import { useLingui } from '@lingui/react/macro';

import { AppDrawerContent } from '@/components/app-drawer-content';
import { HOME_DRAWER_ENABLED, isDrawerPermanent } from '@/constants/navigation';

export default function DrawerLayout() {
  const theme = useThemeTokens();
  const { width } = useWindowDimensions();
  const permanent = isDrawerPermanent(width);
  const { t } = useLingui();

  return (
    <Drawer
      drawerContent={(props) => <AppDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: permanent ? 'permanent' : 'front',
        // With the drawer off there is no hamburger to open it, so the edge
        // gesture would be the only way in -- an invisible entry point to a
        // panel whose every row now lives in the header. It is also the Android
        // system Back gesture (card #564), which is the better owner of that
        // edge.
        swipeEnabled: HOME_DRAWER_ENABLED && !permanent,
        // The terminal is outside this navigator, so the drawer can use the
        // standard edge gesture without competing with terminal panning.
        swipeEdgeWidth: 48,
        swipeMinDistance: 10,
        keyboardDismissMode: 'on-drag',
        overlayColor: 'rgba(3, 8, 14, 0.5)',
        drawerStyle: {
          width: 300,
          backgroundColor: theme.colors.surface,
        },
      }}>
      <Drawer.Screen name="index" options={{ title: t`Muqun` }} />
    </Drawer>
  );
}
