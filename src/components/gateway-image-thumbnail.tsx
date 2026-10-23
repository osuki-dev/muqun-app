import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { useLingui } from '@lingui/react/macro';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { ContentImage } from '@/components/content-image';
import { contentImageIdentity, type ContentImagePreviewState } from '@/lib/content-image-layout';
import { PhotoFileIcon } from '@/icons';
import { useThemeTokens } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { configuredGatewayServerId, gatewayImageBinding } from '@/lib/gateway-client';
import type { MessageImageAsset } from '@/lib/message-images';
import type { PreviewImageSource, PreviewImageDescriptor } from '@/lib/gateway-image-previews';
import { deferUnmappedImage, saveOriginalPreview } from '@/lib/gateway-image-previews';
import { savePreviewImage } from '@/lib/save-file';
import { useFileActions } from '@/hooks/use-file-actions';
import { useServerCapabilities } from '@/stores/server-capabilities';

const NO_CAPABILITIES: string[] = [];

/** Retained raw/unavailable sources are not proof of an authorized bitmap URL. */
export function UnmappedImageThumbnail({
  uri,
  label,
  style,
  onPreviewImage,
  children,
  unavailable = false,
}: {
  uri: string;
  label: string;
  style: StyleProp<ViewStyle>;
  onPreviewImage?: (uri: string) => void;
  children: ReactNode;
  unavailable?: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const serverId = configuredGatewayServerId();
  const capabilities = useServerCapabilities((state) =>
    serverId ? (state.byServer[serverId] ?? NO_CAPABILITIES) : NO_CAPABILITIES
  );
  if (!deferUnmappedImage(capabilities, unavailable)) return <>{children}</>;
  const icon = <PhotoFileIcon size={20} color={theme.colors.textMuted} />;
  if (uri.length <= 8192 && /^https?:\/\//.test(uri) && onPreviewImage)
    return (
      <PressableScale
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
        onPress={() => onPreviewImage(uri)}
        style={[styles.frame, style]}>
        {icon}
      </PressableScale>
    );
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t`Image unavailable`}
      style={[styles.frame, style]}>
      {icon}
    </View>
  );
}

/** A thumbnail failure stays tappable; originals load only for preview or explicit save. */
export function GatewayImageThumbnail({
  asset,
  label,
  style,
  interactive = true,
  sourceOverride,
  onPreview,
  onLongPress,
  block = false,
  compact = false,
}: {
  asset: MessageImageAsset & { gatewayServerId?: string };
  label: string;
  style?: StyleProp<ViewStyle>;
  block?: boolean;
  compact?: boolean;
  interactive?: boolean;
  sourceOverride?: PreviewImageSource | null;
  onPreview?: (image: PreviewImageDescriptor) => void;
  onLongPress?: (image: PreviewImageDescriptor) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const frame = [
    styles.frame,
    block ? { marginVertical: 8 } : null,
    compact ? null : { minWidth: 44, minHeight: 44 },
    style,
  ];
  const serverId = configuredGatewayServerId();
  const capabilities = useServerCapabilities((state) =>
    serverId ? (state.byServer[serverId] ?? NO_CAPABILITIES) : NO_CAPABILITIES
  );
  const binding =
    asset.gatewayServerId && asset.gatewayServerId !== serverId
      ? null
      : gatewayImageBinding(asset, capabilities);
  const fileActions = useFileActions(
    label || t`Image`,
    async () => {
      if (!binding) throw new Error('Image unavailable');
      await saveOriginalPreview(binding.image, savePreviewImage);
    },
    true
  );
  const key =
    binding?.plan.thumbnail?.cacheKey ?? (binding ? `${binding.plan.id}:no-thumbnail` : '');
  const [held, setHeld] = useState<{ key: string; source: PreviewImageSource | null }>({
    key: '',
    source: null,
  });
  const [failed, setFailed] = useState('');
  const [open, setOpen] = useState(false);
  const [previewState, setPreviewState] = useState<ContentImagePreviewState>();
  const source =
    sourceOverride !== undefined ? sourceOverride : held.key === key ? held.source : null;
  const needsRead =
    sourceOverride === undefined && binding !== null && binding.plan.thumbnail !== null;
  const read = useEffectEvent(
    (signal: AbortSignal) => binding?.readThumbnail(signal) ?? Promise.resolve(null)
  );
  useEffect(() => {
    if (!needsRead) return;
    const controller = new AbortController();
    let owned: PreviewImageSource | null = null;
    read(controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) {
          owned = next;
          setHeld({ key, source: next });
        } else next?.dispose?.();
      },
      () => {
        if (!controller.signal.aborted) setFailed(key);
      }
    );
    return () => {
      controller.abort();
      owned?.dispose?.();
    };
  }, [needsRead, key]);
  const nativeKey = source ? `${key}:${source.uri}` : key;
  const bitmap = source && failed !== nativeKey ? source : undefined;
  const content = compact ? (
    bitmap ? (
      <Image
        key={nativeKey}
        source={{ uri: bitmap.uri, headers: bitmap.headers, cacheKey: bitmap.cacheKey }}
        contentFit="contain"
        style={StyleSheet.absoluteFill}
        onError={() => setFailed(nativeKey)}
      />
    ) : (
      <PhotoFileIcon size={20} color={theme.colors.textMuted} />
    )
  ) : (
    <ContentImage
      source={bitmap}
      width={asset.width}
      height={asset.height}
      previewable={interactive && Boolean(binding)}
      placeholder={<PhotoFileIcon size={20} color={theme.colors.textMuted} />}
      onError={() => setFailed(nativeKey)}
      onPreviewStateChange={setPreviewState}
    />
  );
  return (
    <>
      {interactive ? (
        <PressableScale
          accessibilityRole="imagebutton"
          accessibilityLabel={label}
          accessibilityHint={
            !compact &&
            previewState?.identity === contentImageIdentity(bitmap) &&
            previewState.cropped
              ? t`Cropped preview · Open full image`
              : undefined
          }
          disabled={!binding}
          onLongPress={() => {
            if (!binding) return;
            if (onLongPress) onLongPress(binding.image);
            else fileActions.show();
          }}
          onPress={() => {
            if (binding && onPreview) onPreview(binding.image);
            else setOpen(true);
          }}
          style={frame}>
          {content}
        </PressableScale>
      ) : (
        <View style={frame}>{content}</View>
      )}
      {interactive ? fileActions.menu : null}
      {open && binding ? (
        <ImagePreviewModal
          images={[binding.image]}
          initialIndex={0}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
