import { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';

import { CodeLinesView } from '@/components/code-lines-view';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { MarkdownDocumentView } from '@/components/markdown-document-view';
import { SHEET_LADDER } from '@/components/sheet-scene';
import { fileTextPresentation, type TextPreviewFile } from '@/lib/file-text-preview';
import { fenceLanguageForFile, fencedFile } from '@/lib/code-language';
import { markdownPaletteKey } from '@/lib/markdown-palette';
import {
  escapeMarkdownText,
  messageImageResolver,
  rewriteMessageImages,
} from '@/lib/message-images';
import { isSafeExternalLink } from '@/lib/safe-link';
import { indexTextLines } from '@/lib/text-preview';

// Host-relative images cannot be resolved without the document's host context.
// Keep the Files policy for both fetched files and tool-result snapshots.
const documentImageResolver = messageImageResolver(new Map(), new Set());
const DOCUMENT_INSETS = { top: 0, bottom: 40, horizontal: SHEET_LADDER.gutter };

/** Pure body: no loading, asset lookup, download, edit or clipboard ownership.
 * Default layout requires a finite viewport (Files or a large preview).
 * Inline is only for a complete small run admitted by canInlineFileText; it
 * uses the same document cell / code renderer with natural content height.
 */
export function FileTextBody({
  file,
  content,
  markdownStyle,
  testID = 'asset',
  layout = 'viewport',
  showsHorizontalScrollIndicator = true,
}: {
  file: TextPreviewFile;
  content: string;
  markdownStyle: MarkdownStyle;
  testID?: string;
  layout?: 'inline' | 'viewport';
  showsHorizontalScrollIndicator?: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const presentation = fileTextPresentation(file, content);
  const documentText = useMemo(
    () =>
      presentation !== 'document'
        ? content
        : rewriteMessageImages(content, documentImageResolver, (alt) => {
            const label = alt.trim() ? t`Image unavailable: ${alt.trim()}` : t`Image unavailable`;
            return `*${escapeMarkdownText(label)}*`;
          }),
    [content, presentation, t]
  );
  const source = useMemo(
    () => (presentation === 'code' ? fencedFile(content, fenceLanguageForFile(file.name)) : ''),
    [content, file.name, presentation]
  );
  const index = useMemo(
    () => (presentation === 'lines' ? indexTextLines(content) : null),
    [content, presentation]
  );

  if (presentation === 'document') {
    if (layout === 'inline') {
      // This is the actual cell renderer used by MarkdownDocumentView, without
      // creating a flex-root list inside an intrinsically sized transcript row.
      return (
        <BoundedMarkdown
          testID={`${testID}-document`}
          markdown={documentText}
          markdownStyle={markdownStyle}
          flavor="github"
          latexMath
          selectionColor={theme.colors.primarySubtle}
        />
      );
    }
    return (
      <MarkdownDocumentView
        testID={`${testID}-document`}
        markdown={documentText}
        markdownStyle={markdownStyle}
        selectionColor={theme.colors.primarySubtle}
        contentInsets={DOCUMENT_INSETS}
      />
    );
  }
  if (index) {
    return (
      <CodeLinesView
        testID={`${testID}-lines`}
        showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
        lines={index.lines}
        longest={index.longest}
        markdownStyle={markdownStyle}
        inset={SHEET_LADDER.gutter}
        note={t`Too large to highlight — showing plain text.`}
      />
    );
  }
  if (presentation !== 'code') return null;
  const code = (
    <EnrichedMarkdownText
      key={markdownPaletteKey(markdownStyle)}
      flavor="github"
      markdown={source}
      markdownStyle={markdownStyle}
      containerStyle={styles.markdown}
      selectable
      selectionColor={theme.colors.primarySubtle}
      selectionHandleColor={theme.colors.primary}
      streamingAnimation={false}
      textBreakStrategy="simple"
      md4cFlags={{ latexMath: true }}
      onLinkPress={({ url }) => {
        if (isSafeExternalLink(url)) void Linking.openURL(url);
      }}
    />
  );
  if (layout === 'inline') {
    // Fences own their horizontal panning; a short listing needs no vertical
    // ScrollView, flex height, Files bottom inset, or second "open" control.
    return <View testID={`${testID}-code`}>{code}</View>;
  }
  return (
    <ScrollView
      testID={`${testID}-code`}
      style={styles.scroll}
      contentContainerStyle={styles.documentContent}
      showsVerticalScrollIndicator={false}>
      {code}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  documentContent: { paddingHorizontal: SHEET_LADDER.gutter, paddingBottom: 40 },
  markdown: { width: '100%' },
});
