import { Button, Input, Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Image } from 'expo-image';
import { Switch, View } from 'react-native';
import type { useAgentReferences } from '@/hooks/use-agent-references';

/** The same optional reference editor serves built-in and user-authored commands. */
export function AgentReferenceEditor({
  references,
  disabled,
  newAgent,
}: {
  references: ReturnType<typeof useAgentReferences>;
  disabled: boolean;
  newAgent: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <View style={{ gap: 12 }}>
      <Text variant="bodySmall">{t`Reference images`}</Text>
      <Text variant="caption" color={theme.colors.textMuted}>
        {newAgent
          ? t`Optional images stay on this device until you approve sending`
          : t`Reference images can be sent when starting a new assistant`}
      </Text>
      {references.draft.images.map((image, index) => (
        <View
          key={image.id}
          style={{
            gap: 8,
            padding: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 12,
          }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Image
              source={{ uri: image.file.uri }}
              contentFit="cover"
              accessibilityLabel={image.file.name}
              style={{ width: 64, height: 64, borderRadius: 8 }}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} variant="caption">
                {image.file.name}
              </Text>
              {image.upload?.status === 'uploading' ? (
                <Text variant="caption">{t`Uploading…`}</Text>
              ) : image.upload?.status === 'failed' ? (
                <Text variant="caption" color={theme.colors.danger}>
                  {t`Upload failed. Send again to retry, or remove this image.`}
                </Text>
              ) : null}
            </View>
            <Button
              variant="ghost"
              disabled={disabled}
              accessibilityLabel={t`Remove image ${index + 1}`}
              onPress={() => references.remove(image.id)}>{t`Remove`}</Button>
          </View>
          <Input
            label={t`What do you like about this image?`}
            value={image.caption}
            editable={!disabled}
            maxLength={1000}
            multiline
            onChangeText={(caption) => references.edit(image.id, caption, image.use)}
          />
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodySmall">{t`May include in the result`}</Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`Off means reference only. This does not grant permission to publish the image.`}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t`May include image ${index + 1} in the result`}
              disabled={disabled}
              value={image.use === 'may-include'}
              onValueChange={(value) =>
                references.edit(image.id, image.caption, value ? 'may-include' : 'reference-only')
              }
            />
          </View>
        </View>
      ))}
      <Button
        variant="secondary"
        disabled={disabled || references.picking || references.draft.images.length >= 9}
        onPress={() => void references.pick()}>
        {references.picking ? t`Opening photos…` : t`Add reference images`}
      </Button>
      {references.error ? (
        <Text selectable variant="caption" color={theme.colors.danger}>
          {references.error}
        </Text>
      ) : null}
    </View>
  );
}
