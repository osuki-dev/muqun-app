import { useLingui } from '@lingui/react/macro';
import { Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { OpacitySlider } from '@/components/opacity-slider';
import { Button } from '@/components/themed-button';
import { Toggle } from '@/components/toggle';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { terminalBackgroundOpacity } from '@/terminal/background';
import { effectiveThemeManifest, type InstalledTheme } from '@/theme/repository';
import { surfaceBackgroundOpacity } from '@/theme/surface-background';
import { themeOpacityPolicy } from '@/theme/opacity-policy';

/** Saved preferences affect Home branding only, never the launcher identity. */
export function ThemeAppearanceSettings({
  installed,
  disabled,
  onTerminalChange,
  onSurfaceChange,
  onLogoChange,
  onTextChange,
  onReset,
}: {
  installed: InstalledTheme;
  disabled: boolean;
  onTerminalChange: (value: number) => void;
  onSurfaceChange: (value: number) => void;
  onLogoChange: (hidden: boolean) => void;
  onTextChange: (hidden: boolean) => void;
  onReset: () => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const background = useSurfaceBackground();
  const effective = effectiveThemeManifest(installed);
  const variant = effective.variants[resolvedMode];
  const policies = [
    themeOpacityPolicy(effective.variants.light),
    themeOpacityPolicy(effective.variants.dark),
  ];
  const surfaceMinimum = Math.max(...policies.map((policy) => policy.surface.minimum));
  const terminalMinimum = Math.max(...policies.map((policy) => policy.terminal.minimum));
  const custom = [
    installed.terminalBackgroundOpacity,
    installed.surfaceBackgroundOpacity,
    installed.hideHomeLogo,
    installed.hideHomeText,
  ].some((value) => value !== undefined);
  return (
    <View
      testID="theme-appearance-settings"
      style={{
        gap: 12,
        padding: 12,
        borderRadius: 16,
        backgroundColor: background(colors.surfaceRaised),
      }}>
      {policies.some(
        (policy) => policy.surface.baselineIssues.length || policy.terminal.baselineIssues.length
      ) ? (
        <Text
          variant="caption"
          color={colors.textMuted}>{t`Some theme colors need more contrast`}</Text>
      ) : null}
      <OpacityControl
        label={t`Interface background opacity`}
        detail={t`Changes colored backgrounds, not text, icons or artwork`}
        value={surfaceBackgroundOpacity(variant.surfaces?.backgroundOpacity)}
        minimum={surfaceMinimum}
        disabled={disabled}
        testID="theme-surface-opacity"
        onCommit={onSurfaceChange}
      />
      <OpacityControl
        label={t`Terminal background opacity`}
        detail={t`Show the app background behind terminal text`}
        value={terminalBackgroundOpacity(variant.terminal.backgroundOpacity)}
        minimum={terminalMinimum}
        disabled={disabled}
        testID="theme-terminal-opacity"
        onCommit={onTerminalChange}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1 }}>{t`Show Home logo`}</Text>
        <Toggle
          testID="theme-show-home-logo"
          accessibilityLabel={t`Show Home logo`}
          value={effective.homeIdentity?.logo?.mode !== 'hidden'}
          disabled={disabled}
          onValueChange={(visible) => onLogoChange(!visible)}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text>{t`Show Home text`}</Text>
          <Text variant="caption" color={colors.textMuted}>{t`App name and tagline`}</Text>
        </View>
        <Toggle
          testID="theme-show-home-text"
          accessibilityLabel={t`Show Home text`}
          value={effective.homeIdentity?.name?.mode !== 'hidden'}
          disabled={disabled}
          onValueChange={(visible) => onTextChange(!visible)}
        />
      </View>
      {custom ? (
        <Button
          variant="ghost"
          testID="theme-appearance-reset"
          disabled={disabled}
          onPress={onReset}>{t`Use theme defaults`}</Button>
      ) : null}
    </View>
  );
}

function OpacityControl({
  label,
  detail,
  value,
  minimum,
  disabled,
  testID,
  onCommit,
}: {
  label: string;
  detail: string;
  value: number;
  minimum: number;
  disabled: boolean;
  testID: string;
  onCommit: (value: number) => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const [draft, setDraft] = useState<number | null>(null);
  const shown = Math.max(minimum, draft ?? value);
  const minimumPercent = Math.ceil(minimum * 100);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1 }}>{label}</Text>
        <Text
          testID={`${testID}-value`}
          variant="bodySmall"
          style={{ minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
          {Math.round(shown * 100)}%
        </Text>
      </View>
      <Text variant="caption" color={colors.textMuted}>
        {detail}
      </Text>
      <OpacitySlider
        value={shown}
        minimumValue={minimum}
        disabled={disabled}
        label={label}
        testID={testID}
        onValueChange={setDraft}
        onSlidingComplete={(next) => {
          setDraft(null);
          onCommit(next);
        }}
      />
      <Text variant="caption" color={colors.textMuted}>
        {t`Minimum opacity for readable text: ${minimumPercent}%`}
      </Text>
    </View>
  );
}
