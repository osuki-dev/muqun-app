import { memo, useCallback, useMemo, useState } from 'react';
import { Linking, View, StyleSheet, TextInput, Switch, ActivityIndicator } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { ExternalLink, FormInput, Send, Check } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useCompactMarkdownStyle } from '@/hooks/use-markdown-style';
import { withAlpha } from '@/lib/color';
import { isSafeExternalLink } from '@/lib/safe-link';
import { plainFromMarkdown } from '@/lib/markdown-text';
import {
  isFormFieldVisible,
  validateFormField,
  type FormField,
  type FormFieldViolation,
  type FormRequest,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';

export interface AgentFormCardProps {
  request: FormRequest;
  onSubmit: (answers: Record<string, unknown>) => Promise<void>;
  /** A text field took focus: the host scrolls the card above the keyboard. */
  onFieldFocus?: () => void;
}

export const AgentFormCard = memo(function AgentFormCard({
  request,
  onSubmit,
  onFieldFocus,
}: AgentFormCardProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const markdownStyle = useCompactMarkdownStyle('muted');
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

  const [violations, setViolations] = useState<Record<string, FormFieldViolation>>({});

  const setValue = useCallback((key: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    // A field the reader is fixing stops complaining while they fix it.
    setViolations((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /**
   * A field is hidden unless every one of its `when` conditions holds against
   * the answers so far -- which also means a hidden field is never required and
   * never submitted, because the engine did not ask it.
   */
  const visibleFields = useMemo(
    () => request.fields.filter((field) => isFormFieldVisible(field, values)),
    [request.fields, values]
  );

  const handleSubmit = async () => {
    if (submitting) return;
    // Required, min/max, length and pattern, checked before the round trip:
    // the engine's rejection is a turn of the agent loop, and the reader gets
    // it back as an error rather than as a field to correct.
    const found: Record<string, FormFieldViolation> = {};
    for (const field of visibleFields) {
      const violation = validateFormField(field, values[field.key]);
      if (violation) found[field.key] = violation;
    }
    if (Object.keys(found).length > 0) {
      setViolations(found);
      return;
    }
    setViolations({});
    const answers: Record<string, unknown> = {};
    for (const field of visibleFields) {
      if (field.type === 'external') continue;
      if (field.key in values) answers[field.key] = values[field.key];
    }
    setSubmitting(true);
    try {
      await onSubmit(answers);
    } finally {
      setSubmitting(false);
    }
  };

  /** Why this answer was refused, in the reader's language. */
  const violationText = (key: string): string | null => {
    const violation = violations[key];
    if (!violation) return null;
    switch (violation.reason) {
      case 'required':
        return t`This one is required.`;
      case 'min_length':
        return t`At least ${violation.limit} characters.`;
      case 'max_length':
        return t`At most ${violation.limit} characters.`;
      case 'pattern':
        return t`That does not match the expected format.`;
      case 'format':
        return t`That is not a valid ${violation.format}.`;
      case 'min':
        return t`At least ${violation.limit}.`;
      case 'max':
        return t`At most ${violation.limit}.`;
    }
  };

  const FieldProblem = ({ fieldKey }: { fieldKey: string }) => {
    const text = violationText(fieldKey);
    if (!text) return null;
    return (
      <Text variant="caption" color={theme.colors.danger} style={styles.fieldProblem}>
        {text}
      </Text>
    );
  };

  /**
   * The question, on one line.
   *
   * A title labels a control and has to stay one line beside it, so this is
   * the one piece of engine text the card does not render: its block syntax is
   * taken off instead, and what is left is the words. A title that arrived as
   * `**Branch**` reads as "Branch" rather than as four asterisks.
   */
  const FieldTitle = ({ field }: { field: FormField }) => (
    <Text variant="caption" color={theme.colors.text} style={styles.fieldTitle}>
      {plainFromMarkdown(field.title)}
      {field.required ? ' *' : ''}
    </Text>
  );

  /**
   * What the question means, as the engine wrote it.
   *
   * The description is the long half of a field and the half a model fills
   * with a list of the values it will accept, a path in backticks, or a link
   * to what it is about. It is outside every pressable, so nothing it draws
   * can swallow a tap meant for the control under it.
   */
  const FieldDescription = ({ field }: { field: FormField }) =>
    field.description ? (
      <BoundedMarkdown
        markdown={field.description}
        markdownStyle={markdownStyle}
        containerStyle={styles.fieldDesc}
        openLinks={false}
      />
    ) : null;

  const renderField = (field: FormField) => {
    switch (field.type) {
      case 'string': {
        const currentVal = (values[field.key] as string) ?? '';
        if (field.options && field.options.length > 0) {
          return (
            <View key={field.key} style={styles.fieldRow}>
              <FieldTitle field={field} />
              <FieldDescription field={field} />
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
                            ? withAlpha(theme.colors.primary, 0.13)
                            : theme.colors.surfaceRaised,
                          borderColor: selected ? theme.colors.primary : theme.colors.border,
                        },
                      ]}>
                      {selected ? <Check size={12} color={theme.colors.primary} /> : null}
                      <Text
                        variant="caption"
                        color={selected ? theme.colors.primary : theme.colors.text}>
                        {plainFromMarkdown(opt.label)}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
              <FieldProblem fieldKey={field.key} />
            </View>
          );
        }

        return (
          <View key={field.key} style={styles.fieldRow}>
            <FieldTitle field={field} />
            <FieldDescription field={field} />
            <TextInput
              value={currentVal}
              onChangeText={(text) => setValue(field.key, text)}
              placeholder={field.placeholder ?? t`Type here…`}
              placeholderTextColor={theme.colors.textSubtle}
              onFocus={onFieldFocus}
              style={[
                styles.textInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: withAlpha(theme.colors.surface, 0.5),
                },
              ]}
            />
            <FieldProblem fieldKey={field.key} />
          </View>
        );
      }

      case 'boolean': {
        const currentVal = !!values[field.key];
        return (
          <View key={field.key} style={[styles.fieldRow, styles.booleanRow]}>
            <View style={styles.flexOne}>
              <FieldTitle field={field} />
              <FieldDescription field={field} />
            </View>
            <Switch
              value={currentVal}
              onValueChange={(val) => setValue(field.key, val)}
              trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
              thumbColor={theme.colors.surface}
            />
          </View>
        );
      }

      case 'number': {
        const currentVal = String(values[field.key] ?? '');
        return (
          <View key={field.key} style={styles.fieldRow}>
            <FieldTitle field={field} />
            <TextInput
              keyboardType="numeric"
              value={currentVal}
              onChangeText={(text) => setValue(field.key, Number(text) || 0)}
              style={[
                styles.textInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: withAlpha(theme.colors.surface, 0.5),
                },
              ]}
            />
            <FieldProblem fieldKey={field.key} />
          </View>
        );
      }

      case 'multiselect': {
        const currentVals = (values[field.key] as string[]) ?? [];
        const selectedVals = new Set(currentVals);
        return (
          <View key={field.key} style={styles.fieldRow}>
            <FieldTitle field={field} />
            <View style={styles.optionsWrap}>
              {field.options.map((opt) => {
                const selected = selectedVals.has(opt.value);
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
                          ? withAlpha(theme.colors.primary, 0.13)
                          : theme.colors.surfaceRaised,
                        borderColor: selected ? theme.colors.primary : theme.colors.border,
                      },
                    ]}>
                    {selected ? <Check size={12} color={theme.colors.primary} /> : null}
                    <Text
                      variant="caption"
                      color={selected ? theme.colors.primary : theme.colors.text}>
                      {plainFromMarkdown(opt.label)}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        );
      }

      case 'external':
        // A consent or sign-in link. It used to render as nothing at all, so a
        // form made only of these was a title and a Submit button.
        return (
          <View key={field.key} style={styles.fieldRow}>
            <FieldTitle field={field} />
            <FieldDescription field={field} />
            <PressableScale
              testID={`agent-form-external-${field.key}`}
              accessibilityRole="link"
              accessibilityLabel={plainFromMarkdown(field.title)}
              onPress={() => {
                if (isSafeExternalLink(field.url)) void Linking.openURL(field.url);
              }}
              style={[
                styles.externalBtn,
                {
                  backgroundColor: withAlpha(theme.colors.info, 0.1),
                  borderColor: theme.colors.info,
                },
              ]}>
              <ExternalLink size={13} color={theme.colors.info} />
              <Text variant="caption" numberOfLines={1} color={theme.colors.info}>
                {field.url}
              </Text>
            </PressableScale>
          </View>
        );

      default:
        // A field type this build has never seen. Its title is still worth
        // showing: the reader is being asked something, and a silent gap is a
        // form that cannot be answered for a reason nobody stated.
        return (
          <View key={field.key} style={styles.fieldRow}>
            <FieldTitle field={field} />
            <Text variant="caption" color={theme.colors.textMuted} style={styles.fieldProblem}>
              <Trans>This question needs a newer app to answer.</Trans>
            </Text>
          </View>
        );
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
        <View style={[styles.iconBox, { backgroundColor: withAlpha(theme.colors.info, 0.13) }]}>
          <FormInput size={16} color={theme.colors.info} />
        </View>
        {/*
          What the card is, not what the engine called it. `request.title` is
          the tool's own -- "Questions" for a single yes-or-no, and untranslated
          in every locale this app ships. The number of fields is the fact worth
          stating, and it is the one the reader can check.
        */}
        <Text variant="bodySmall" color={theme.colors.text} style={styles.title}>
          <Plural value={visibleFields.length} one="Question" other="Questions" />
        </Text>
      </View>

      {/* Fields */}
      <View style={styles.fieldsContainer}>{visibleFields.map(renderField)}</View>

      {/* Submit Button */}
      <PressableScale
        disabled={submitting}
        onPress={handleSubmit}
        style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]}>
        {submitting ? (
          <ActivityIndicator size="small" color={theme.colors.onPrimary} />
        ) : (
          <>
            <Send size={14} color={theme.colors.onPrimary} />
            <Text variant="caption" color={theme.colors.onPrimary} style={styles.submitText}>
              <Trans>Submit</Trans>
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
    fontSize: AGENT_TYPE.meta.size,
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
    fontSize: AGENT_TYPE.meta.size,
  },
  fieldDesc: {
    alignSelf: 'stretch',
  },
  // The app's own lines about a field -- why an answer was refused, and the
  // one about a field type this build cannot draw. Never the engine's.
  fieldProblem: {
    fontSize: AGENT_TYPE.micro.size,
  },
  textInput: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: AGENT_TYPE.meta.size,
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
  externalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
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
    fontSize: AGENT_TYPE.meta.size,
  },
});
