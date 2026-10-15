import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { useLingui } from '@lingui/react/macro';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { FileImage } from 'lucide-react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { configuredGatewayServerId, gatewayImageBinding } from '@/lib/gateway-client';
import type { MessageImageAsset } from '@/lib/message-images';
import type { PreviewImageSource, PreviewImageDescriptor } from '@/lib/gateway-image-previews';
import { deferUnmappedImage } from '@/lib/gateway-image-previews';
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
  const icon = <FileImage size={20} color={theme.colors.textMuted} />;
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

/** A thumbnail failure stays tappable; only an opened preview can fetch an original. */
export function GatewayImageThumbnail({
  asset,
  label,
  style,
  interactive = true,
  sourceOverride,
  onPreview,
  block = false,
}: {
  asset: MessageImageAsset & { gatewayServerId?: string };
  label: string;
  style?: StyleProp<ViewStyle>;
  block?: boolean;
  interactive?: boolean;
  sourceOverride?: PreviewImageSource | null;
  onPreview?: (image: PreviewImageDescriptor) => void;
}) {
  const theme = useThemeTokens();
  const viewport = useWindowDimensions();
  const frame = [
    styles.frame,
    block
      ? {
          width: '100%' as const,
          aspectRatio: asset.width && asset.height ? asset.width / asset.height : 16 / 9,
          maxHeight: viewport.height * 0.45,
        }
      : null,
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
  const key =
    binding?.plan.thumbnail?.cacheKey ?? (binding ? `${binding.plan.id}:no-thumbnail` : '');
  const [held, setHeld] = useState<{ key: string; source: PreviewImageSource | null }>({
    key: '',
    source: null,
  });
  const [failed, setFailed] = useState('');
  const [open, setOpen] = useState(false);
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
  const content =
    source && failed !== nativeKey ? (
      <Image
        key={nativeKey}
        source={{ uri: source.uri, headers: source.headers, cacheKey: source.cacheKey }}
        contentFit={block ? 'contain' : 'cover'}
        style={StyleSheet.absoluteFill}
        onError={() => setFailed(nativeKey)}
      />
    ) : (
      <FileImage size={20} color={theme.colors.textMuted} />
    );
  return (
    <>
      {interactive ? (
        <PressableScale
          accessibilityRole="imagebutton"
          accessibilityLabel={label}
          disabled={!binding}
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
  frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
