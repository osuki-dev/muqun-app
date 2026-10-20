import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { DocumentIcon, PhotoFileIcon } from '@/icons';
import { GatewayImageThumbnail } from '@/components/gateway-image-thumbnail';
import type { MessageImageAsset } from '@/lib/message-images';
import { DURATION, fadeIn } from '@/lib/motion';
import {
  readUploadImageSource,
  uploadImageSource,
  uploadNameFromPath,
  type AssetImageSource,
} from '@/lib/gateway-client';

/** One file a sent or queued prompt carries. */
export interface ThumbnailEntry {
  key: string;
  name: string;
  /** A device file, a URL, a `data:` URI, or a host path under the upload folder. */
  uri: string;
  image: boolean;
  /** The Gateway asset that serves it; drawn as a delivered message's image is. */
  asset?: MessageImageAsset;
}

const SIZE = 36;

/**
 * Small thumbnails for a prompt that has left the composer: the inbox card's
 * rows and the acknowledgement of a direct send. An image with a Gateway asset
 * is the same `GatewayImageThumbnail` a delivered message draws; without one
 * (an older Gateway, or this device's own picked files) an upload path is read
 * back through `/api/uploads` and a local or `data:` URI is shown directly.
 * Anything else is a compact file chip.
 */
export function AttachmentThumbnailRow({ entries }: { entries: readonly ThumbnailEntry[] }) {
  const theme = useThemeTokens();
  if (entries.length === 0) return null;
  return (
    <View style={styles.row}>
      {entries.map((entry) =>
        entry.asset ? (
          <GatewayImageThumbnail
            key={entry.key}
            asset={entry.asset}
            label={entry.name}
            compact
            style={[styles.tile, { backgroundColor: theme.colors.surfaceRaised }]}
          />
        ) : entry.image ? (
          <ThumbnailImage key={entry.key} entry={entry} />
        ) : (
          <FileChip key={entry.key} name={entry.name} />
        )
      )}
    </View>
  );
}

function directSource(uri: string): AssetImageSource | null {
  if (/^(data:|https?:|file:|content:|ph:|assets-library:)/i.test(uri))
    return { uri, cacheKey: uri.length > 512 ? `inline:${uri.length}:${uri.slice(-64)}` : uri };
  const upload = uploadNameFromPath(uri);
  return upload ? uploadImageSource(upload) : null;
}

function ThumbnailImage({ entry }: { entry: ThumbnailEntry }) {
  const theme = useThemeTokens();
  const upload = /^[a-z][a-z0-9+.-]*:/i.test(entry.uri) ? null : uploadNameFromPath(entry.uri);
  const [source, setSource] = useState<AssetImageSource | null>(() => directSource(entry.uri));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // The encrypted transport has no direct URL: read and decode the bytes.
    if (source || !upload) return;
    const controller = new AbortController();
    readUploadImageSource(upload, { signal: controller.signal }).then(setSource, () =>
      setFailed(true)
    );
    return () => controller.abort();
  }, [source, upload]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={entry.name}
      style={[styles.tile, { backgroundColor: theme.colors.surfaceRaised }]}>
      {source && !failed ? (
        <Image
          source={source}
          style={styles.image}
          contentFit="cover"
          transition={DURATION.micro}
          onError={() => setFailed(true)}
        />
      ) : (
        <Animated.View entering={fadeIn('micro')}>
          <PhotoFileIcon size={16} color={theme.colors.textMuted} />
        </Animated.View>
      )}
    </View>
  );
}

function FileChip({ name }: { name: string }) {
  const theme = useThemeTokens();
  return (
    <View style={[styles.chip, { backgroundColor: theme.colors.surfaceRaised }]}>
      <DocumentIcon size={12} color={theme.colors.primary} />
      <Text variant="caption" color={theme.colors.text} numberOfLines={1} style={styles.chipName}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, gap: 6 },
  tile: {
    width: SIZE,
    height: SIZE,
    borderRadius: 8,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  chip: {
    height: SIZE,
    maxWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderCurve: 'continuous',
  },
  chipName: { flexShrink: 1 },
});
