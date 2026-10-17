import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens, PressableScale } from '@osuki-dev/ui';
import { FileText } from 'lucide-react-native';
import { ContentImage } from '@/components/content-image';
import { contentImageIdentity, type ContentImagePreviewState } from '@/lib/content-image-layout';
import { useLingui } from '@lingui/react/macro';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import {
  readUploadImageSource,
  uploadImageSource,
  uploadNameFromPath,
  type AssetImageSource,
} from '@/lib/gateway-client';

/**
 * One attached image. A data URI or a URL is shown as it is; a host path under
 * the gateway's upload folder is fetched back from the gateway with the
 * device's credentials (streamed by expo-image on a plain transport, decoded
 * from authenticated bytes on an encrypted one). Anything that cannot load
 * stays a quiet placeholder rather than an empty box.
 */
export const AttachmentImage = memo(function AttachmentImage({
  uri,
  label,
  onPreviewImage,
}: {
  uri: string;
  label: string;
  onPreviewImage: (uri: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const uploadName =
    uri.startsWith('data:') || /^https?:/.test(uri) ? null : uploadNameFromPath(uri);
  const [source, setSource] = useState<AssetImageSource | null>(() =>
    uploadName ? uploadImageSource(uploadName) : { uri, cacheKey: uri }
  );
  const [failed, setFailed] = useState(false);
  const [previewState, setPreviewState] = useState<ContentImagePreviewState>();
  useEffect(() => {
    if (!uploadName || source) return;
    const controller = new AbortController();
    readUploadImageSource(uploadName, { signal: controller.signal })
      .then((resolved) => setSource(resolved))
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, [uploadName, source]);

  if (failed || !source) {
    return (
      <View style={[styles.attachmentThumbnail, styles.attachmentPlaceholder]}>
        <FileText size={16} color={theme.colors.textSubtle} />
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityHint={
        previewState?.identity === contentImageIdentity(source) && previewState.cropped
          ? t`Cropped preview · Open full image`
          : undefined
      }
      onPress={() => onPreviewImage(source.uri)}
      style={[styles.attachmentImageWrapper, { borderRadius: profile.chrome.surface }]}>
      <ContentImage
        source={source}
        previewable
        onError={() => setFailed(true)}
        onPreviewStateChange={setPreviewState}
      />
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  attachmentPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  attachmentImageWrapper: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minWidth: 44,
    minHeight: 44,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  attachmentThumbnail: { width: 160, height: 110 },
});
