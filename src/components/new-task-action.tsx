/**
 * New Task, on a home-screen server card's `...` menu.
 *
 * Self-contained on purpose. The home screen decides nothing about this: it
 * hands over a server id, and the component answers with a button or with
 * nothing at all. That keeps the whole capability question -- which is the only
 * interesting thing here -- in one file, and keeps a busy list screen from
 * growing a third concern it has to hydrate and gate.
 *
 * "Nothing at all" is the common case and the correct one. A gateway too old to
 * spawn, and a server this device has never opened (so has never heard the
 * answer from), both get no button. A greyed one would promise a feature the
 * machine does not have; an enabled one would fail on tap.
 */
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useRouter, type Href } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { gatewaySupportsAgentSpawn } from '@/lib/gateway-client';
import { useServerCapabilities } from '@/stores/server-capabilities';

export function NewTaskAction({ serverId, label }: { serverId: string; label: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const router = useRouter();

  // Hydrated from here rather than from the screen, so the home list does not
  // have to know this mirror exists. The store claims the flag before it reads,
  // so several cards mounting together still make one read.
  const hydrate = useServerCapabilities((state) => state.hydrate);
  const capabilities = useServerCapabilities((state) => state.byServer[serverId]);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!gatewaySupportsAgentSpawn(capabilities)) return null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`New task on ${label}`}
      onPress={() =>
        // No session id and no tab: the home screen knows neither, and the
        // sheet resolves the session itself once it has selected this server.
        router.push({ pathname: '/new-task', params: { serverId, origin: 'home' } } as Href)
      }
      style={[styles.button, { backgroundColor: theme.colors.primarySubtle }]}>
      <Sparkles size={16} color={theme.colors.primary} strokeWidth={2} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // The row menu's own button chassis, so this sits in the line of three
  // without being the odd one.
  button: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
