import { FileNotOnComputer, useFileResolver } from './file-computer-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { PhotoFileIcon, DocumentIcon } from '@/icons';
import { useThemeTokens, useToast, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { useLingui } from '@lingui/react/macro';
import { AssetViewer } from '@/components/asset-viewer';
import { GatewayImageThumbnail } from '@/components/gateway-image-thumbnail';
import { configuredGatewayServerId, resolveMcpFileAsset } from '@/lib/gateway-client';
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
  remoteFile,
}: {
  file: { uri: string; name: string };
  asid: string;
  remoteFile?: SessionAsset;
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
  return <RawFileLink file={file} asid={asid} remoteFile={remoteFile} />;
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

/**
 * Opens one session file at a time: resolves it on the session's computer
 * (the resolver may ask which computer holds it), then shows the viewer.
 * Shared by file chips and file links drawn inline in a message's text.
 */
export function useSessionFileOpener() {
  const { t } = useLingui();
  const { showToast } = useToast();
  const [asset, setAsset] = useState<SessionAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Set<AbortController>());
  useEffect(() => {
    const requests = pending.current;
    return () => {
      for (const controller of requests) controller.abort();
      requests.clear();
    };
  }, []);
  const load = (resolve: (signal: AbortSignal) => Promise<SessionAsset>) => {
    const controller = new AbortController();
    pending.current.add(controller);
    return resolve(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) throw new Error('Operation cancelled');
        return result;
      })
      .finally(() => pending.current.delete(controller));
  };
  const open = (resolve: (signal: AbortSignal) => Promise<SessionAsset>) => {
    if (busy) return;
    setBusy(true);
    void load(resolve)
      .then(setAsset)
      .catch((error: unknown) => {
        if (error instanceof Error && /cancel/i.test(error.message)) return;
        showToast({
          variant: 'danger',
          title: t`Could not open file`,
          message:
            error instanceof AudioPlaybackError
              ? t`Update the Gateway to open or save this file.`
              : error instanceof FileNotOnComputer
                ? error.message
                : t`Try again`,
        });
      })
      .then(() => setBusy(false));
  };
  const viewer = asset ? <AssetViewer asset={asset} onClose={() => setAsset(null)} /> : null;
  return { busy, load, open, viewer };
}

function RawFileLink({
  file,
  asid,
  remoteFile,
}: {
  file: { uri: string; name: string };
  asid: string;
  remoteFile?: SessionAsset;
}) {
  const resolveFile = useFileResolver();
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [serverId] = useState(configuredGatewayServerId);
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file.uri);
  const opener = useSessionFileOpener();
  const resolve = (signal: AbortSignal) =>
    remoteFile
      ? resolveMcpFileAsset(remoteFile, signal)
      : resolveFile(asid, file.uri, signal, serverId);
  const actions = useFileActions(
    file.name,
    async () => saveSessionAsset(await opener.load(resolve)),
    isImage
  );
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Open ${file.name}`}
        disabled={opener.busy}
        onLongPress={actions.show}
        onPress={() => opener.open(resolve)}
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
        {opener.busy ? (
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
      {opener.viewer}
    </View>
  );
}
