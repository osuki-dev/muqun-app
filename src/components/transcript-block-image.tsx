import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useLingui } from '@lingui/react/macro';
import { Text } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

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
  const viewport = useWindowDimensions();
  const profile = useAppearanceProfile();
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(width && height ? width / height : 16 / 9);
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
        disabled={!onPress}
        onPress={() => onPress?.(uri)}
        style={[
          styles.image,
          {
            aspectRatio: ratio,
            maxHeight: viewport.height * 0.45,
            borderRadius: profile.chrome.surface,
          },
        ]}>
        <Image
          source={{ uri, ...(headers ? { headers } : {}) }}
          contentFit="contain"
          style={StyleSheet.absoluteFill}
          onLoad={({ source }) => {
            if (source.width > 0 && source.height > 0) setRatio(source.width / source.height);
          }}
          onError={() => setFailed(true)}
        />
      </PressableScale>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { width: '100%', paddingVertical: 8 },
  image: { width: '100%', overflow: 'hidden' },
});
