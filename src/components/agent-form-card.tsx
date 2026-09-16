import { memo, useState } from 'react';
import { View, StyleSheet, TextInput, Switch, ActivityIndicator } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { FormInput, Send, Check } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { FormRequest, FormField } from '@/lib/agent-session';

export interface AgentFormCardProps {
  request: FormRequest;
  onSubmit: (answers: Record<string, unknown>) => Promise<void>;
}

export const AgentFormCard = memo(function AgentFormCard({
  request,
  onSubmit,
}: AgentFormCardProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [submitting, setSubmitting] = useState(false);

  // Initialize form state
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of request.fields) {
      if (field.type === 'string') {
        initial[field.key] = field.default ?? '';
      } else if (field.type === 'number') {
        initial[field.key] = field.default ?? 0;
      } else if (field.type === 'boolean') {
        initial[field.key] = field.default ?? false;
      } else if (field.type === 'multiselect') {
        initial[field.key] = field.default ?? [];
      }
    }
    return initial;
  });

  const setValue = (key: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field: FormField) => {
    switch (field.type) {
      case 'string': {
        const currentVal = (values[field.key] as string) ?? '';
        if (field.options && field.options.length > 0) {
          return (
            <View key={field.key} style={styles.fieldRow}>
              <Text variant="caption" color={theme.colors.text} style={styles.fieldTitle}>
                {field.title} {field.required ? '*' : ''}
              </Text>
              {field.description ? (
                <Text variant="caption" color={theme.colors.textMuted} style={styles.fieldDesc}>
                  {field.description}
                </Text>
              ) : null}
              <View style={styles.optionsWrap}>
                {field.options.map((opt) => {
                  const selected = currentVal === opt.value;
                  return (
                    <PressableScale
                      key={opt.value}
                      onPress={() => setValue(field.key, opt.value)}
                      style={[
                        styles.optionPill,
                        {
                          backgroundColor: selected
                            ? `${theme.colors.primary}22`
                            : `${theme.colors.surfaceRaised}`,
                          borderColor: selected ? theme.colors.primary : theme.colors.border,
                        },
                      ]}>
                      {selected ? <Check size={12} color={theme.colors.primary} /> : null}
                      <Text
                        variant="caption"
                        color={selected ? theme.colors.primary : theme.colors.text}>
                        {opt.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          );
        }

        return (
          <View key={field.key} style={styles.fieldRow}>
            <Text variant="caption" color={theme.colors.text} style={styles.fieldTitle}>
              {field.title} {field.required ? '*' : ''}
            </Text>
            {field.description ? (
              <Text variant="caption" color={theme.colors.textMuted} style={styles.fieldDesc}>
                {field.description}
              </Text>
            ) : null}
            <TextInput
              value={currentVal}
              onChangeText={(text) => setValue(field.key, text)}
              placeholder={field.placeholder ?? t`Type here…`}
              placeholderTextColor={theme.colors.textSubtle}
              style={[
                styles.textInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: `${theme.colors.surface}80`,
                },
              ]}
            />
          </View>
        );
      }

      case 'boolean': {
        const currentVal = !!values[field.key];
        return (
          <View key={field.key} style={[styles.fieldRow, styles.booleanRow]}>
            <View style={styles.flexOne}>
              <Text variant="caption" color={theme.colors.text} style={styles.fieldTitle}>
                {field.title}
              </Text>
              {field.description ? (
                <Text variant="caption" color={theme.colors.textMuted} style={styles.fieldDesc}>
                  {field.description}
                </Text>
              ) : null}
            </View>
            <Switch
              value={currentVal}
              onValueChange={(val) => setValue(field.key, val)}
              trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
              thumbColor="#fff"
            />
          </View>
        );
      }

      case 'number': {
        const currentVal = String(values[field.key] ?? '');
        return (
          <View key={field.key} style={styles.fieldRow}>
            <Text variant="caption" color={theme.colors.text} style={styles.fieldTitle}>
              {field.title} {field.required ? '*' : ''}
            </Text>
            <TextInput
              keyboardType="numeric"
              value={currentVal}
              onChangeText={(text) => setValue(field.key, Number(text) || 0)}
              style={[
                styles.textInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: `${theme.colors.surface}80`,
                },
              ]}
            />
          </View>
        );
      }

      case 'multiselect': {
        const currentVals = (values[field.key] as string[]) ?? [];
        return (
          <View key={field.key} style={styles.fieldRow}>
            <Text variant="caption" color={theme.colors.text} style={styles.fieldTitle}>
              {field.title}
            </Text>
            <View style={styles.optionsWrap}>
              {field.options.map((opt) => {
                const selected = currentVals.includes(opt.value);
                return (
                  <PressableScale
                    key={opt.value}
                    onPress={() => {
                      if (selected) {
                        setValue(
                          field.key,
                          currentVals.filter((v) => v !== opt.value)
                        );
                      } else {
                        setValue(field.key, [...currentVals, opt.value]);
                      }
                    }}
                    style={[
                      styles.optionPill,
                      {
                        backgroundColor: selected
                          ? `${theme.colors.primary}22`
                          : `${theme.colors.surfaceRaised}`,
                        borderColor: selected ? theme.colors.primary : theme.colors.border,
                      },
                    ]}>
                    {selected ? <Check size={12} color={theme.colors.primary} /> : null}
                    <Text
                      variant="caption"
                      color={selected ? theme.colors.primary : theme.colors.text}>
                      {opt.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        );
      }

      default:
        return null;
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          borderColor: theme.colors.info,
        },
      ]}>
      {/* Title */}
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: `${theme.colors.info}20` }]}>
          <FormInput size={16} color={theme.colors.info} />
        </View>
        <Text variant="bodySmall" color={theme.colors.text} style={styles.title}>
          {request.title}
        </Text>
      </View>

      {/* Fields */}
      <View style={styles.fieldsContainer}>{request.fields.map(renderField)}</View>

      {/* Submit Button */}
      <PressableScale
        disabled={submitting}
        onPress={handleSubmit}
        style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]}>
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Send size={14} color="#fff" />
            <Text variant="caption" color="#fff" style={styles.submitText}>
              <Trans>Submit Response</Trans>
            </Text>
          </>
        )}
      </PressableScale>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: 'hidden',
    marginVertical: 6,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: '700',
    fontSize: 13,
  },
  fieldsContainer: {
    gap: 12,
    marginBottom: 14,
  },
  fieldRow: {
    gap: 4,
  },
  booleanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flexOne: {
    flex: 1,
  },
  fieldTitle: {
    fontWeight: '600',
    fontSize: 12,
  },
  fieldDesc: {
    fontSize: 11,
  },
  textInput: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  optionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
  },
  submitText: {
    fontWeight: '700',
    fontSize: 12,
  },
});
