import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ContentImage } from '@/components/content-image';
import { contentImageIdentity, type ContentImagePreviewState } from '@/lib/content-image-layout';
import { useLingui } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useFileActions } from '@/hooks/use-file-actions';
import { savePreviewImage } from '@/lib/save-file';

/** Images own their layout so asynchronous decoding cannot resize a native text span. */
export function TranscriptBlockImage({
  uri,
  alt,
  headers,
  pending = false,
  width,
  height,
  onPress,
}: {
  uri: string;
  alt: string;
  headers?: Record<string, string>;
  pending?: boolean;
  width?: number;
  height?: number;
  onPress?: (uri: string) => void;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const [failed, setFailed] = useState(false);
  const [previewState, setPreviewState] = useState<ContentImagePreviewState>();
  const fileActions = useFileActions(
    alt || t`Image`,
    () => savePreviewImage({ uri, headers }),
    true
  );
  if (pending || failed)
    return (
      <Text variant="caption">
        {pending ? t`Loading…` : alt ? t`Image unavailable: ${alt}` : t`Image unavailable`}
      </Text>
    );
  return (
    <View style={styles.container}>
      <PressableScale
        accessibilityRole="imagebutton"
        accessibilityLabel={alt || t`Image`}
        accessibilityHint={
          previewState?.identity === contentImageIdentity({ uri }) && previewState.cropped
            ? t`Cropped preview · Open full image`
            : undefined
        }
        disabled={!onPress}
        onPress={() => onPress?.(uri)}
        onLongPress={fileActions.show}
        style={[
          styles.image,
          {
            borderRadius: profile.chrome.surface,
          },
        ]}>
        <ContentImage
          source={{ uri, ...(headers ? { headers } : {}) }}
          width={width}
          height={height}
          previewable={Boolean(onPress)}
          onError={() => setFailed(true)}
          onPreviewStateChange={setPreviewState}
        />
      </PressableScale>
      {fileActions.menu}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 8 },
  image: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minWidth: 44,
    minHeight: 44,
    overflow: 'hidden',
  },
});
