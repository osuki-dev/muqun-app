import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { FileText } from 'lucide-react-native';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { AssetViewer } from '@/components/asset-viewer';
import { configuredGatewayServerId, resolveAgentFileAsset } from '@/lib/gateway-client';
import { saveSessionAsset } from '@/lib/save-file';
import { useFileActions } from '@/hooks/use-file-actions';
import type { SessionAsset } from '@/lib/session-assets';
import { AudioPlaybackError } from '@/lib/audio-playback-session';

export function InlineFileLink({
  file,
  asid,
}: {
  file: { uri: string; name: string };
  asid: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const [asset, setAsset] = useState<SessionAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverId] = useState(configuredGatewayServerId);
  const pending = useRef(new Set<AbortController>());
  useEffect(() => {
    const requests = pending.current;
    return () => {
      for (const controller of requests) controller.abort();
      requests.clear();
    };
  }, []);
  const resolve = () => {
    const controller = new AbortController();
    pending.current.add(controller);
    return resolveAgentFileAsset(asid, file.uri, controller.signal, serverId)
      .then((result) => {
        if (controller.signal.aborted) throw new Error('Operation cancelled');
        return result;
      })
      .finally(() => pending.current.delete(controller));
  };
  const actions = useFileActions(
    file.name,
    async () => saveSessionAsset(await resolve()),
    /\.(png|jpe?g|gif|webp)$/i.test(file.uri)
  );
  return (
    <View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Open ${file.name}`}
        disabled={busy}
        onLongPress={actions.show}
        onPress={() => {
          setBusy(true);
          void resolve()
            .then(setAsset)
            .catch((error: unknown) => {
              if (error instanceof Error && /cancel/i.test(error.message)) return;
              showToast({
                variant: 'danger',
                title: t`Could not open file`,
                message:
                  error instanceof AudioPlaybackError
                    ? t`Update the Gateway to open or save this file.`
                    : t`Try again`,
              });
            })
            .then(() => setBusy(false));
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          backgroundColor: theme.colors.surfaceRaised,
          borderRadius: 12,
        }}>
        <FileText size={18} color={theme.colors.primary} />
        <Text numberOfLines={1} style={{ flex: 1 }}>
          {file.name}
        </Text>
      </PressableScale>
      {actions.menu}
      {asset && <AssetViewer asset={asset} onClose={() => setAsset(null)} />}
    </View>
  );
}
