import { useContext, type ComponentProps } from 'react';
import { DiagramVisibility } from '@/components/diagram-visibility';
import { StyleSheet, View } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Diagram } from '@osuki-dev/skia-diagrams/react';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { splitDiagramMarkdown } from '@/lib/diagram-markdown';
import { markdownPaletteKey } from '@/lib/markdown-palette';

/** Closed fences become native diagrams; streaming fences keep their source visible. */
export function DiagramMarkdown(props: ComponentProps<typeof EnrichedMarkdownText>) {
  const router = useRouter();
  const active = useContext(DiagramVisibility);
  const parts = splitDiagramMarkdown(props.markdown);
  const paletteKey = markdownPaletteKey(props.markdownStyle ?? {});
  if (!parts.some((part) => part.source !== undefined))
    return <EnrichedMarkdownText key={paletteKey} {...props} />;
  return (
    <View style={styles.content}>
      {parts.map((part) =>
        part.source !== undefined ? (
          <Diagram
            active={active}
            expandControl="on-tap"
            fitToViewport
            key={part.start}
            source={part.source}
            testID={`mermaid-diagram-${part.start}`}
            onExpand={() =>
              router.navigate({
                pathname: '/diagram-viewer',
                params: { source: part.source, links: props.onLinkPress ? '1' : '0' },
              })
            }
            onInteraction={(interaction) => {
              if (interaction.kind === 'link') props.onLinkPress?.({ url: interaction.target });
            }}
            onLongPress={() => {
              void Clipboard.setStringAsync(part.source ?? '').then(() =>
                props.onCopyPress?.({ language: 'mermaid', code: part.source ?? '' })
              );
            }}
            fallback={() => (
              <EnrichedMarkdownText key={paletteKey} {...props} markdown={part.markdown} />
            )}
          />
        ) : (
          <EnrichedMarkdownText
            key={`${part.start}:${paletteKey}`}
            {...props}
            markdown={part.markdown}
          />
        )
      )}
    </View>
  );
}
const styles = StyleSheet.create({ content: { alignSelf: 'stretch', gap: 8 } });
