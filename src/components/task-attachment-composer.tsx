import { useState, type ComponentProps } from 'react';
import { View } from 'react-native';
import { Paperclip } from 'lucide-react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { TerminalComposer } from './terminal-composer';
import { AttachmentMenu } from './attachment-menu';
import { AttachmentStrip } from './attachment-strip';
import { PressableScale } from './pressable-scale';
import { LADDER } from './settings-chrome';
import { pickAttachments, describePickerFailure, type AttachmentSource } from '@/lib/attachments';
import type { useTaskInputAttachments } from '@/hooks/use-task-input-attachments';

/** The controller owns commit/recovery; this component only stages explicit input files. */
export function TaskAttachmentComposer({
  attachments,
  available,
  onPreview,
  ...composer
}: {
  attachments: ReturnType<typeof useTaskInputAttachments>;
  available: boolean;
  onPreview: (attachmentId: string) => void;
} & Omit<ComponentProps<typeof TerminalComposer>, 'leading'>) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function choose(source: AttachmentSource) {
    setOpen(false);
    const ticket = attachments.capturePicker();
    if (!available || !ticket.isCurrent()) return;
    setError(null);
    void (attachments.pickDemoFiles ? attachments.pickDemoFiles(source) : pickAttachments(source))
      .then(ticket.addFiles)
      .catch((failure: unknown) => {
        if (ticket.isCurrent()) setError(describePickerFailure(source, failure));
      });
  }
  return (
    <View style={{ gap: LADDER.gap }}>
      <AttachmentStrip
        attachments={attachments.attachments}
        onRemove={attachments.removeAttachment}
        onRetry={(id) => (attachments.isExpired(id) ? onPreview(id) : attachments.retryUpload(id))}
        onPreview={onPreview}
        textColor={theme.colors.text}
      />
      {attachments.pickDemoFiles ? (
        <Text variant="caption">{t`Demo files are simulated. No system picker or upload runs.`}</Text>
      ) : null}
      {error ? <Text variant="caption">{error}</Text> : null}
      {available && open ? (
        <AttachmentMenu onSelect={choose} textColor={theme.colors.text} />
      ) : null}
      {!available ? (
        <Text variant="caption">{t`Update this Gateway to attach files to managed tasks.`}</Text>
      ) : null}
      {attachments.uploading ? <Text variant="caption">{t`Uploading attachments…`}</Text> : null}
      <TerminalComposer
        {...composer}
        leading={
          <PressableScale
            testID="task-input-add"
            accessibilityRole="button"
            accessibilityLabel={t`Add attachment`}
            disabled={!available || composer.send.sending}
            onPress={() => setOpen((value) => !value)}
            style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Paperclip size={20} color={available ? theme.colors.text : theme.colors.textMuted} />
          </PressableScale>
        }
      />
    </View>
  );
}
