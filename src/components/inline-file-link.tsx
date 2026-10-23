import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { PhotoFileIcon, DocumentIcon } from '@/icons';
import { useThemeTokens, useToast, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { useLingui } from '@lingui/react/macro';
import { AssetViewer } from '@/components/asset-viewer';
import { GatewayImageThumbnail } from '@/components/gateway-image-thumbnail';
import { configuredGatewayServerId, resolveAgentFileAsset } from '@/lib/gateway-client';
import { savePreviewImage, saveSessionAsset } from '@/lib/save-file';
import { useFileActions } from '@/hooks/use-file-actions';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { SessionAsset } from '@/lib/session-assets';
import { AudioPlaybackError } from '@/lib/audio-playback-session';
import type { MessageImageAsset } from '@/lib/message-images';
import {
  saveOriginalPreview,
  type PreviewImageDescriptor,
  type PreviewImageSource,
} from '@/lib/gateway-image-previews';
import { useStableHandler } from '@/hooks/use-render-refs';

export function InlineFileLink({
  file,
  asid,
  imageAsset,
  imageSource,
}: {
  file: { uri: string; name: string };
  asid: string;
  imageAsset?: MessageImageAsset;
  /** Already authorized by the message's thumbnail reader; never resolved here. */
  imageSource?: PreviewImageSource | null;
}) {
  if (imageAsset?.src === file.uri && imageAsset.mime.startsWith('image/'))
    return (
      <MappedImageFileLink
        key={JSON.stringify(imageAsset)}
        file={file}
        imageAsset={imageAsset}
        imageSource={imageSource ?? null}
      />
    );
  return <RawFileLink file={file} asid={asid} />;
}

/** A mapped thumbnail, open and save all use the same Gateway descriptor. */
function MappedImageFileLink({
  file,
  imageAsset,
  imageSource,
}: {
  file: { uri: string; name: string };
  imageAsset: MessageImageAsset;
  imageSource: PreviewImageSource | null;
}) {
  const [selected, setSelected] = useState<PreviewImageDescriptor | null>(null);
  const [pending] = useState(() => new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    },
    [pending]
  );
  const actions = useFileActions(
    file.name,
    async () => {
      if (!selected) throw new Error('Image unavailable');
      const controller = new AbortController();
      pending.add(controller);
      await saveOriginalPreview(selected, savePreviewImage, controller.signal).finally(() =>
        pending.delete(controller)
      );
    },
    true
  );
  const showActions = useStableHandler((image: PreviewImageDescriptor) => {
    setSelected(image);
    actions.show();
  });
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
      <GatewayImageThumbnail
        asset={imageAsset}
        label={file.name}
        sourceOverride={imageSource}
        onLongPress={showActions}
      />
      <Text variant="caption" style={{ maxWidth: 280 }}>
        {file.name}
      </Text>
      {actions.menu}
    </View>
  );
}

function RawFileLink({ file, asid }: { file: { uri: string; name: string }; asid: string }) {
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const [asset, setAsset] = useState<SessionAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverId] = useState(configuredGatewayServerId);
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file.uri);
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
  const actions = useFileActions(file.name, async () => saveSessionAsset(await resolve()), isImage);
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
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
          alignSelf: 'flex-start',
          maxWidth: '100%',
          minHeight: 44,
          minWidth: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 8,
          paddingVertical: 6,
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          borderRadius: 12,
        }}>
        {/* Finding the file on the computer can take seconds; the link says it
            heard the tap rather than looking dead until the viewer opens. */}
        {busy ? (
          <ActivityIndicator size={14} color={theme.colors.primary} />
        ) : isImage ? (
          <PhotoFileIcon size={14} color={theme.colors.primary} />
        ) : (
          <DocumentIcon size={14} color={theme.colors.primary} />
        )}
        <Text variant="caption" style={{ flexShrink: 1 }}>
          {file.name}
        </Text>
      </PressableScale>
      {actions.menu}
      {asset && <AssetViewer asset={asset} onClose={() => setAsset(null)} />}
    </View>
  );
}
