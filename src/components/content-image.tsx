import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { FileImage } from 'lucide-react-native';
import { Text } from '@/components/text';
import { useLatestReader } from '@/hooks/use-render-refs';
import {
  contentImageIdentity,
  contentImageLayout,
  type ContentImagePreviewState,
} from '@/lib/content-image-layout';
import type { PreviewSize } from '@/lib/image-preview-geometry';

/** Presentation only: dimensions come from metadata or this already-requested bitmap. */
export function ContentImage({
  source,
  width,
  height,
  previewable = false,
  placeholder,
  onError,
  onPreviewStateChange,
}: {
  source?: { uri: string; headers?: Record<string, string>; cacheKey?: string };
  width?: number;
  height?: number;
  previewable?: boolean;
  placeholder?: ReactNode;
  onError?: () => void;
  onPreviewStateChange?: (state: ContentImagePreviewState) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const viewport = useWindowDimensions();
  const key = contentImageIdentity(source);
  const currentIdentity = useLatestReader(key);
  const [failed, setFailed] = useState<string>();
  const [decoded, setDecoded] = useState<{ key: string | undefined; size: PreviewSize } | null>(
    null
  );
  const size =
    width && height ? { width, height } : decoded?.key === key ? decoded?.size : undefined;
  const layout = contentImageLayout(size, viewport, previewable);
  const cropped = Boolean(source && failed !== key && layout.cropped);
  useEffect(() => {
    onPreviewStateChange?.({ identity: key, cropped });
  }, [key, cropped, onPreviewStateChange]);
  return (
    <View style={{ width: layout.width, maxWidth: '100%', alignSelf: 'flex-start' }}>
      <View style={[styles.bitmap, { aspectRatio: layout.width / layout.height }]}>
        {source && failed !== key ? (
          <Image
            key={key}
            source={{ uri: source.uri, headers: source.headers, cacheKey: source.cacheKey }}
            style={StyleSheet.absoluteFill}
            contentFit={layout.cropped ? 'cover' : 'contain'}
            contentPosition={layout.cropped ? 'top' : 'center'}
            onLoad={({ source: loaded }) => {
              if (currentIdentity() !== key) return;
              setDecoded({ key, size: { width: loaded.width, height: loaded.height } });
            }}
            onError={() => {
              if (currentIdentity() !== key) return;
              setFailed(key);
              onError?.();
            }}
          />
        ) : (
          (placeholder ?? <FileImage size={20} color={theme.colors.textMuted} />)
        )}
      </View>
      {cropped ? (
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Cropped preview · Open full image`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bitmap: { width: '100%', alignItems: 'center', justifyContent: 'center' },
});
