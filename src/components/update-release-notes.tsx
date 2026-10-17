import { useLingui } from '@lingui/react';
import { useThemeTokens, Text } from '@osuki-dev/ui';
import { StyleSheet, View } from 'react-native';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { useCompactMarkdownStyle } from '@/hooks/use-markdown-style';
import { RELEASE_NOTES } from '@/lib/release-notes';

/** Server Markdown and bundled localized notes remain distinct sources. */
export function UpdateReleaseNotes({ notes, bundled }: { notes: string | null; bundled: boolean }) {
  const { _ } = useLingui();
  const theme = useThemeTokens();
  const markdownStyle = useCompactMarkdownStyle('body');
  if (notes) return <BoundedMarkdown markdown={notes} markdownStyle={markdownStyle} />;
  if (!bundled) return null;
  return (
    <View testID="bundled-release-notes" style={styles.items}>
      {RELEASE_NOTES.items.map((item, index) => (
        <Text
          key={item.id ?? item.message}
          testID={`bundled-release-note-${index}`}
          variant="bodySmall"
          weight="regular"
          color={theme.colors.text}>
          {_(item)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ items: { gap: 16 } });
