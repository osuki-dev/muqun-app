import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';

import { GatewayImageThumbnail } from '@/components/gateway-image-thumbnail';
import { useFileResolver } from '@/components/file-computer-picker';
import { basename } from '@/lib/agent-tool-output';
import { useLatestRef } from '@/hooks/use-render-refs';
import { assetMessageImage, configuredGatewayServerId } from '@/lib/gateway-client';
import type { SessionAsset } from '@/lib/session-assets';

/**
 * The picture a read-like tool opened: the file is resolved through the
 * session's file-asset route, like any file the transcript points at, and drawn
 * as the same capped thumbnail that opens the lightbox on a tap.
 */
export function ToolReadImage({ asid, path }: { asid: string; path: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const resolveFile = useLatestRef(useFileResolver());
  const [state, setState] = useState<SessionAsset | 'failed' | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    resolveFile.current(asid, path, controller.signal, configuredGatewayServerId()).then(
      (asset) => {
        if (!controller.signal.aborted) setState(asset);
      },
      () => {
        if (!controller.signal.aborted) setState('failed');
      }
    );
    return () => controller.abort();
  }, [asid, path, resolveFile]);
  const image = useMemo(
    () => (state && state !== 'failed' && state.kind === 'image' ? assetMessageImage(state) : null),
    [state]
  );
  if (state === null) return null;
  if (!image) {
    return (
      <View style={styles.missing}>
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Image unavailable`}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.frame}>
      <GatewayImageThumbnail asset={image} label={basename(path)} style={styles.thumb} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'flex-start' },
  thumb: { borderRadius: 8 },
  missing: { paddingVertical: 8 },
});
