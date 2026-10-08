import { useLingui } from '@lingui/react/macro';
import { Linking, StyleSheet, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { DiagramViewer } from '@osuki-dev/skia-diagrams/react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isSafeExternalLink } from '@/lib/safe-link';
import { useAppActive } from '@/hooks/use-app-active';
import { copyDiagram } from '@/lib/copy-diagram';

export default function DiagramViewerScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const params = useLocalSearchParams<{ source?: string; links?: string }>();
  const source = typeof params.source === 'string' ? params.source : '';
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <DiagramViewer
        active={focused && appActive}
        source={source}
        labels={{
          close: t`Close`,
          fit: t`Fit diagram`,
          actualSize: t`Actual size`,
          copy: t`Copy`,
          svg: `${t`Copy`} SVG`,
          png: `${t`Copy`} PNG`,
        }}
        onClose={() => router.back()}
        onExport={(_kind, data) =>
          copyDiagram(data).catch(() => {
            throw new Error(t`Something went wrong`);
          })
        }
        onCopySource={() => {
          void Clipboard.setStringAsync(source);
        }}
        onInteraction={(interaction) => {
          if (
            params.links === '1' &&
            interaction.kind === 'link' &&
            isSafeExternalLink(interaction.target)
          )
            void Linking.openURL(interaction.target);
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({ screen: { flex: 1 } });
