import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/text';
import { SettingsSegmented } from '@/components/settings-segmented';
import { FontedTextInput } from '@/components/fonted-text-input';
import {
  SheetScene,
  SheetSceneAction,
  SheetSceneQuietAction,
  SheetSceneField,
  SheetSceneFooter,
  SheetSceneRow,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import {
  VOICE_DEFAULTS,
  isOpenAiVoiceEndpoint,
  missingVoiceCredentials,
  voiceDraftForMode,
} from '@/lib/voice-service-config';
import { voiceRecorderAvailable } from '@/lib/voice-recorder-capability';
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from '@/i18n/locale';
import {
  loadVoiceSettings,
  normalizeVoiceConfig,
  saveVoiceSettings,
  useVoiceSettings,
  type VoiceMode,
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
  const navigation = useNavigation();
  const theme = useThemeTokens();
  const field = useSheetSceneInputStyle();
  const insets = useSafeAreaInsets();
  const config = useVoiceSettings((state) => state.config);
  const loadError = useVoiceSettings((state) => state.loadError);
  const [url, setUrl] = useState(config?.url ?? VOICE_DEFAULTS.file.url);
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? VOICE_DEFAULTS.file.model);
  const [language, setLanguage] = useState<AppLocale | 'auto' | null>(config?.language ?? null);
  const [mode, setMode] = useState<VoiceMode>(config?.mode ?? 'file');
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [attemptedSave, setAttemptedSave] = useState(false);
  const official = isOpenAiVoiceEndpoint(url);
  const missing = missingVoiceCredentials({ url, apiKey, model });
  async function save(clear = false) {
    setAttemptedSave(!clear);
    const next = clear ? null : normalizeVoiceConfig(url, apiKey, model, language, mode);
    if (!clear && !next) {
      setMessage(
        mode === 'realtime'
          ? t`Enter a valid WSS realtime URL. API key and model are optional.`
          : t`Enter a valid HTTPS API URL. API key and model are optional.`
      );
      return;
    }
    if (!clear && missing.length) {
      setMessage('');
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
    setUrl(next?.url ?? VOICE_DEFAULTS.file.url);
    setApiKey(next?.apiKey ?? '');
    setModel(next?.model ?? VOICE_DEFAULTS.file.model);
    setLanguage(next?.language ?? null);
    setMode(next?.mode ?? 'file');
    setBusy(false);
    if (clear) {
      setMessage(t`Voice to text disabled`);
    } else if (navigation.isFocused() && navigation.canGoBack()) {
      Keyboard.dismiss();
      navigation.goBack();
    }
  }
  return (
    <ScrollView
      nestedScrollEnabled
      style={sheetSceneStyles.scroller}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}>
      <View style={[sheetSceneStyles.column, styles.form]}>
        {!voiceRecorderAvailable() && (
          <Text
            color={
              theme.colors.textMuted
            }>{t`Install an app build with voice recording support to use the microphone.`}</Text>
        )}
        <Text
          variant="bodySmall"
          color={
            theme.colors.textMuted
          }>{t`Hold Send to speak. Stop to add the text to your draft, then edit and send.`}</Text>
        <Text variant="caption" color={theme.colors.textMuted}>{t`Transcription mode`}</Text>
        <SettingsSegmented
          testID="voice-service-mode"
          value={mode}
          options={[
            { value: 'file', label: t`After recording` },
            { value: 'realtime', label: t`Realtime` },
          ]}
          onChange={(value) => {
            if (!busy && (value === 'file' || value === 'realtime')) {
              const draft = voiceDraftForMode({ url, model }, mode, value);
              setUrl(draft.url);
              setModel(draft.model);
              setAttemptedSave(false);
              setMode(value);
              setMessage('');
            }
          }}
        />
        {mode === 'realtime' && (
          <Text variant="caption" color={theme.colors.textMuted}>
            {t`Streams speech while you talk. Requires an OpenAI Realtime-compatible transcription endpoint.`}
          </Text>
        )}
        <View style={styles.language}>
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
        </View>
        <SheetSceneField label={t`API URL`}>
          <FontedTextInput
            testID="voice-service-url"
            accessibilityLabel={t`API URL`}
            value={url}
            onChangeText={setUrl}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={VOICE_DEFAULTS[mode].url}
            placeholderTextColor={theme.colors.textSubtle}
            style={field}
          />
        </SheetSceneField>
        <SheetSceneField
          label={official ? t`API key` : t`API key (optional)`}
          error={attemptedSave && missing.includes('apiKey') ? t`Required.` : undefined}>
          <FontedTextInput
            testID="voice-service-key"
            accessibilityLabel={official ? t`API key` : t`API key (optional)`}
            value={apiKey}
            onChangeText={setApiKey}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            autoComplete="off"
            placeholderTextColor={theme.colors.textSubtle}
            style={field}
          />
        </SheetSceneField>
        <SheetSceneField
          label={official ? t`Model` : t`Model (optional)`}
          error={attemptedSave && missing.includes('model') ? t`Required.` : undefined}>
          <FontedTextInput
            testID="voice-service-model"
            accessibilityLabel={t`Model`}
            value={model}
            onChangeText={setModel}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={VOICE_DEFAULTS[mode].model}
            placeholderTextColor={theme.colors.textSubtle}
            style={field}
          />
        </SheetSceneField>
        <Text
          variant="caption"
          color={
            theme.colors.textMuted
          }>{t`OpenAI requires an API key and model. Compatible services may provide their own defaults. Your API key is stored securely on this device.`}</Text>
        <View style={styles.actions}>
          <SheetSceneAction
            label={t`Save`}
            labelWeight="regular"
            testID="voice-settings-save"
            busy={busy}
            onPress={() => void save()}
          />
          {(config || loadError) && (
            <SheetSceneQuietAction
              label={t`Clear configuration`}
              labelWeight="regular"
              testID="voice-settings-clear"
              disabled={busy}
              onPress={() => void save(true)}
            />
          )}
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
  form: { paddingTop: 8, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
  language: { marginHorizontal: -20 },
  actions: { gap: 4, paddingTop: 6 },
});
