import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Button } from './themed-button';
import { Input } from './themed-input';
import { ImagePreviewModal } from './image-preview-modal';
import { PressableScale } from './pressable-scale';
import { LADDER } from './settings-chrome';
import { utf8Bytes } from '@/lib/multipart';
import type { useTaskInputAttachments } from '@/hooks/use-task-input-attachments';

/** Explicit reference intent and local preview; opening details never uploads or sends. */
export function TaskInputDetails({
  attachments,
  attachmentId,
  onClose,
  disabled = false,
}: {
  attachments: ReturnType<typeof useTaskInputAttachments>;
  attachmentId: string | null;
  onClose: () => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const entry = attachments.attachments.find((item) => item.id === attachmentId);
  if (!entry) return null;
  const previewable =
    /^image\/(png|jpeg|webp|gif|heic|heif)$/.test(entry.mime) &&
    /^(file|content):\/\//.test(entry.localUri);
  const use = entry.use ?? 'reference-only';
  return (
    <View testID="task-input-details" style={{ gap: LADDER.gap }}>
      <Text>{entry.name}</Text>
      <Input
        testID="task-input-caption"
        label={t`Reference description`}
        value={entry.caption ?? ''}
        multiline
        editable={!disabled}
        onChangeText={(caption) => {
          if (utf8Bytes(caption).length > 4096) {
            setTooLong(true);
            return;
          }
          setTooLong(false);
          attachments.annotateAttachment(entry.id, caption, use);
        }}
        error={tooLong ? t`This description is too long. Shorten it before continuing.` : undefined}
      />
      {(['reference-only', 'may-include'] as const).map((value) => (
        <PressableScale
          key={value}
          testID={`task-input-use-${value}`}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === use, selected: value === use, disabled }}
          disabled={disabled}
          onPress={() => attachments.annotateAttachment(entry.id, entry.caption ?? '', value)}
          style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text>
            {value === use ? '✓ ' : ''}
            {value === 'reference-only' ? t`Reference only` : t`May include in the result`}
          </Text>
        </PressableScale>
      ))}
      <Text variant="caption">{t`Permission to include a reference does not authorize publishing or uploading it elsewhere.`}</Text>
      {attachments.isExpired(entry.id) ? (
        <>
          <Text variant="caption">{t`This upload expired. Re-upload it explicitly before sending.`}</Text>
          <Button
            testID="task-input-reupload"
            disabled={disabled || entry.status === 'uploading'}
            onPress={() => attachments.reuploadExpired(entry.id)}>{t`Re-upload file`}</Button>
        </>
      ) : null}
      {previewable ? (
        <Button
          testID="task-input-preview"
          variant="ghost"
          onPress={() => setPreviewId(entry.id)}>{t`Preview file`}</Button>
      ) : null}
      <Button testID="task-input-close" variant="ghost" onPress={onClose}>{t`Close`}</Button>
      {previewable && previewId === entry.id ? (
        <ImagePreviewModal
          images={[{ id: entry.id, uri: entry.localUri }]}
          initialIndex={0}
          onClose={() => setPreviewId(null)}
        />
      ) : null}
    </View>
  );
}
