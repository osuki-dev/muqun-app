import { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';

import { BoundedMarkdown } from '@/components/bounded-markdown';
import { useCompactMarkdownStyle } from '@/hooks/use-markdown-style';
import { hasMarkdownStructure } from '@/lib/markdown-text';
import { AGENT_TYPE } from '@/constants/agent-type';

/**
 * What the engine said went wrong, said as it was said.
 *
 * Two shapes arrive on the same field. Most failures are one sentence --
 * `ENOENT: no such file or directory` -- and a sentence is a line of red text.
 * Some are a small document: a stack under a heading, a list of files that
 * could not be written, a fenced excerpt of the command's own output. Those
 * were drawn as one unbroken run with their fences and backticks showing,
 * which is the same complaint the transcript had everywhere else.
 *
 * So the shape decides, once, here -- rather than each card deciding for its
 * own error field -- and a structured failure reads through the same markdown
 * pipeline as everything else, in the danger ink.
 */
export const EngineFailureText = memo(function EngineFailureText({
  message,
  testID,
}: {
  message: string;
  testID?: string;
}) {
  const theme = useThemeTokens();
  const markdownStyle = useCompactMarkdownStyle('danger');

  if (!hasMarkdownStructure(message)) {
    return (
      <Text
        testID={testID}
        variant="caption"
        selectable
        color={theme.colors.danger}
        style={styles.line}>
        {message}
      </Text>
    );
  }
  return (
    <BoundedMarkdown
      testID={testID}
      markdown={message}
      markdownStyle={markdownStyle}
      containerStyle={styles.stretch}
      openLinks={false}
    />
  );
});

const styles = StyleSheet.create({
  line: {
    flexShrink: 1,
    fontSize: AGENT_TYPE.micro.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
  stretch: {
    alignSelf: 'stretch',
  },
});
