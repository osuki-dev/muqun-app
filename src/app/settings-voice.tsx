import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/text';
import { SettingsSegmented } from '@/components/settings-segmented';
import { FontedTextInput } from '@/components/fonted-text-input';
import { PressableScale } from '@/components/pressable-scale';
import {
  SheetScene,
  SheetSceneField,
  SheetSceneFooter,
  SheetSceneRow,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { voiceRecorderAvailable } from '@/lib/voice-recorder-capability';
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from '@/i18n/locale';
import {
  loadVoiceSettings,
  normalizeVoiceConfig,
  saveVoiceSettings,
  useVoiceSettings,
  type VoiceMode,
} from '@/stores/voice-settings';

const VOICE_ENDPOINTS = {
  file: 'https://api.openai.com/v1/audio/transcriptions',
  realtime: 'wss://api.openai.com/v1/realtime?intent=transcription',
} as const;

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
  const profile = useAppearanceProfile();
  const insets = useSafeAreaInsets();
  const config = useVoiceSettings((state) => state.config);
  const loadError = useVoiceSettings((state) => state.loadError);
  const [url, setUrl] = useState(config?.url ?? VOICE_ENDPOINTS.file);
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [language, setLanguage] = useState<AppLocale | 'auto' | null>(config?.language ?? null);
  const [mode, setMode] = useState<VoiceMode>(config?.mode ?? 'file');
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(clear = false) {
    const next = clear ? null : normalizeVoiceConfig(url, apiKey, model, language, mode);
    if (!clear && !next) {
      setMessage(
        mode === 'realtime'
          ? t`Enter a valid WSS realtime URL. API key and model are optional.`
          : t`Enter a valid HTTPS API URL. API key and model are optional.`
      );
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
              if (!url || url === VOICE_ENDPOINTS[mode]) setUrl(VOICE_ENDPOINTS[value]);
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
            placeholder={VOICE_ENDPOINTS[mode]}
            placeholderTextColor={theme.colors.textSubtle}
            style={field}
          />
        </SheetSceneField>
        <SheetSceneField label={t`API key (optional)`}>
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
            placeholderTextColor={theme.colors.textSubtle}
            style={field}
          />
        </SheetSceneField>
        <SheetSceneField label={t`Model (optional)`}>
          <FontedTextInput
            testID="voice-service-model"
            accessibilityLabel={t`Model`}
            value={model}
            onChangeText={setModel}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={mode === 'realtime' ? 'gpt-live-transcribe' : 'gpt-4o-mini-transcribe'}
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
          <PressableScale
            accessibilityRole="button"
            disabled={busy}
            testID="voice-settings-save"
            accessibilityLabel={t`Save`}
            onPress={() => void save()}
            style={[
              styles.button,
              { backgroundColor: theme.colors.primary, borderRadius: profile.chrome.control },
            ]}>
            <Text variant="bodySmall" color={theme.colors.onPrimary}>{t`Save`}</Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            disabled={busy || (!config && !loadError)}
            testID="voice-settings-clear"
            accessibilityLabel={t`Clear configuration`}
            onPress={() => void save(true)}
            style={styles.button}>
            <Text variant="bodySmall" color={theme.colors.textMuted}>{t`Clear configuration`}</Text>
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
  form: { paddingTop: 8, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
  language: { marginHorizontal: -20 },
  actions: { gap: 4, paddingTop: 6 },
  button: { paddingHorizontal: 18, paddingVertical: 12, minHeight: 44, alignItems: 'center' },
});
