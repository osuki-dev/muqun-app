import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/text';
import { SettingsToggleRow } from '@/components/settings-chrome';
import { FontedTextInput } from '@/components/fonted-text-input';
import { PressableScale } from '@/components/pressable-scale';
import { SheetScene, SheetSceneFooter, SheetSceneRow } from '@/components/sheet-scene';
import { voiceRecorderAvailable } from '@/lib/voice-recorder-capability';
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from '@/i18n/locale';
import { useInterfaceFontFamily } from '@/hooks/use-user-fonts';
import {
  loadVoiceSettings,
  normalizeVoiceConfig,
  saveVoiceSettings,
  useVoiceSettings,
} from '@/stores/voice-settings';

export default function SettingsVoiceScreen() {
  const { t } = useLingui();
  const ready = useVoiceSettings((state) => state.ready);
  useEffect(() => {
    void loadVoiceSettings();
  }, []);
  return (
    <SheetScene title={t`Voice to text`} testID="settings-voice-sheet">
      {ready ? <VoiceSettingsForm /> : <Text>{t`Loading…`}</Text>}
    </SheetScene>
  );
}

function VoiceSettingsForm() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const fontFamily = useInterfaceFontFamily() ?? undefined;
  const insets = useSafeAreaInsets();
  const config = useVoiceSettings((state) => state.config);
  const loadError = useVoiceSettings((state) => state.loadError);
  const [url, setUrl] = useState(config?.url ?? 'https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [language, setLanguage] = useState<AppLocale | 'auto' | null>(config?.language ?? null);
  const [autoInsert, setAutoInsert] = useState(config?.autoInsert ?? true);
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const field = [
    styles.field,
    { color: theme.colors.text, backgroundColor: theme.colors.surface, fontFamily },
  ];
  async function save(clear = false) {
    const next = clear ? null : normalizeVoiceConfig(url, apiKey, model, language, autoInsert);
    if (!clear && !next) {
      setMessage(t`Enter a valid HTTPS base URL. API key and model are optional.`);
      return;
    }
    setBusy(true);
    setChoosingLanguage(false);
    setMessage('');
    try {
      await saveVoiceSettings(next);
    } catch {
      setMessage(t`Could not save voice settings. Please try again.`);
      setBusy(false);
      return;
    }
    setUrl(next?.url ?? '');
    setApiKey(next?.apiKey ?? '');
    setModel(next?.model ?? '');
    setLanguage(next?.language ?? null);
    setAutoInsert(next?.autoInsert ?? true);
    setMessage(clear ? t`Voice to text disabled` : t`Saved`);
    setBusy(false);
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}>
      <View style={styles.form}>
        {!voiceRecorderAvailable() && (
          <Text
            color={
              theme.colors.textMuted
            }>{t`Install an app build with voice recording support to use the microphone.`}</Text>
        )}
        <SettingsToggleRow
          label={t`Insert text automatically`}
          detail={t`Insert recognized text into the draft without sending. Turn off to review first.`}
          value={autoInsert}
          disabled={busy}
          onValueChange={setAutoInsert}
        />
        <SheetSceneRow
          title={t`Recognition language`}
          caption={
            language === 'auto'
              ? t`Auto-detect`
              : language
                ? LOCALE_LABELS[language]
                : t`Follow App language`
          }
          onPress={() => {
            if (!busy) setChoosingLanguage(!choosingLanguage);
          }}
        />
        {choosingLanguage && (
          <View>
            <SheetSceneRow
              title={t`Follow App language`}
              selected={language === null}
              onPress={() => {
                setLanguage(null);
                setChoosingLanguage(false);
              }}
            />
            <SheetSceneRow
              title={t`Auto-detect`}
              selected={language === 'auto'}
              onPress={() => {
                setLanguage('auto');
                setChoosingLanguage(false);
              }}
            />
            {APP_LOCALES.map((locale) => (
              <SheetSceneRow
                key={locale}
                title={LOCALE_LABELS[locale]}
                selected={language === locale}
                onPress={() => {
                  setLanguage(locale);
                  setChoosingLanguage(false);
                }}
              />
            ))}
          </View>
        )}
        <Text
          color={
            theme.colors.textMuted
          }>{t`Configure your speech service, then hold Send to record. Tap the animation to stop and transcribe.`}</Text>
        <Text>{t`Base URL`}</Text>
        <FontedTextInput
          testID="voice-service-url"
          accessibilityLabel={t`Base URL`}
          value={url}
          onChangeText={setUrl}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://api.openai.com/v1"
          style={field}
        />
        <Text>{t`API key (optional)`}</Text>
        <FontedTextInput
          testID="voice-service-key"
          accessibilityLabel={t`API key`}
          value={apiKey}
          onChangeText={setApiKey}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          autoComplete="off"
          style={field}
        />
        <Text>{t`Model (optional)`}</Text>
        <FontedTextInput
          testID="voice-service-model"
          accessibilityLabel={t`Model`}
          value={model}
          onChangeText={setModel}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="gpt-4o-mini-transcribe"
          style={field}
        />
        <Text
          color={
            theme.colors.textMuted
          }>{t`Uses the OpenAI-compatible /audio/transcriptions API. Your API key is stored securely on this device.`}</Text>
        <View style={styles.actions}>
          <PressableScale
            accessibilityRole="button"
            disabled={busy}
            testID="voice-settings-save"
            accessibilityLabel={t`Save`}
            onPress={() => void save()}
            style={[styles.button, { backgroundColor: theme.colors.primary }]}>
            <Text color={theme.colors.onPrimary}>{t`Save`}</Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            disabled={busy || (!config && !loadError)}
            testID="voice-settings-clear"
            accessibilityLabel={t`Clear configuration`}
            onPress={() => void save(true)}
            style={styles.button}>
            <Text color={theme.colors.text}>{t`Clear configuration`}</Text>
          </PressableScale>
        </View>
        {message || loadError ? (
          <Text accessibilityLiveRegion="polite" color={theme.colors.textMuted}>
            {message || t`Could not read voice settings. Save your configuration again.`}
          </Text>
        ) : null}
      </View>
      <SheetSceneFooter bottomInset={insets.bottom} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 20, gap: 12, width: '100%', maxWidth: 640, alignSelf: 'center' },
  field: { borderRadius: 12, padding: 14, fontSize: 16, minHeight: 48 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16, minHeight: 44 },
});
