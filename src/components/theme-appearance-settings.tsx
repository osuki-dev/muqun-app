import { useLingui } from '@lingui/react/macro';

import { resolveHomeIdentity } from '@/theme/resolve';
import { Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { OpacitySlider } from '@/components/opacity-slider';
import { SettingsSegmented } from '@/components/settings-segmented';
import { Button } from '@/components/themed-button';
import { Toggle } from '@/components/toggle';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { terminalBackgroundOpacity } from '@/terminal/background';
import { type HomeHeroPreference } from '@/theme/home-hero';
import {
  effectiveThemeManifest,
  homeHeroPreference,
  type InstalledTheme,
} from '@/theme/repository';
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
  onHeroChange,
  onReset,
}: {
  installed: InstalledTheme;
  disabled: boolean;
  onTerminalChange: (value: number) => void;
  onSurfaceChange: (value: number) => void;
  onLogoChange: (hidden: boolean) => void;
  onTextChange: (hidden: boolean) => void;
  onHeroChange: (value: HomeHeroPreference) => void;
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
    installed.homeHero,
  ].some((value) => value !== undefined);
  const hero = homeHeroPreference(installed);
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
        detail={t`Changes coloured backgrounds, not text, icons or artwork`}
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
          value={resolveHomeIdentity(effective).logo !== null}
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
          value={resolveHomeIdentity(effective).name !== null}
          disabled={disabled}
          onValueChange={(visible) => onTextChange(!visible)}
        />
      </View>
      {/* Three answers rather than a switch, because "follow the theme" is a
          real third state here and not the absence of a decision: a pack can
          ship a Home illustration and turn it off, and a reader who has never
          touched this row should stay on whatever the next version of the pack
          decides. The caption says what `Shown` does beyond flipping a switch
          -- it is the only way to reach the empty-state picture, and a reader
          who turns it on for a theme that drew no hero deserves to know why
          something appeared. */}
      <View style={{ gap: 6 }}>
        <Text>{t`Show illustration on Home`}</Text>
        <Text
          variant="caption"
          color={
            colors.textMuted
          }>{t`Between the header and your servers. Home also borrows the theme's empty-state picture when the theme has no Home illustration of its own.`}</Text>
        <SettingsSegmented
          testID="theme-home-hero"
          options={[
            { label: t`Theme default`, value: 'theme' },
            { label: t`Shown`, value: 'shown' },
            { label: t`Hidden`, value: 'hidden' },
          ]}
          value={hero}
          onChange={(value) => {
            if (!disabled) onHeroChange(value as HomeHeroPreference);
          }}
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
  /**
   * The contrast floor advises here; it does not hold the slider.
   *
   * Two different things were being decided by one number. `clampThemeOpacity`
   * raises an *authored* value to this floor at install time, and that is worth
   * keeping: it governs what a pack someone else made can impose on a reader
   * who never asked for it. This control is the other case entirely -- the
   * owner of the device, moving their own slider, on a wallpaper they chose.
   * Refusing them is not protection, it is a guess about their eyes made by a
   * formula that assumes the worst possible backdrop (`minimumContrast` bounds
   * every pair against pure black *and* pure white, so the floor can never
   * reach 0 no matter how dark the picture actually is).
   *
   * So the number stays on screen, as the recommendation it always was, and
   * the travel below it is theirs. Anyone who takes the terminal to nothing
   * and cannot read it has the same slider to bring it back.
   */
  const shown = draft ?? value;
  const minimumPercent = Math.ceil(minimum * 100);
  const belowRecommended = shown + 0.0001 < minimum;
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
        minimumValue={0}
        disabled={disabled}
        label={label}
        testID={testID}
        onValueChange={setDraft}
        onSlidingComplete={(next) => {
          setDraft(null);
          onCommit(next);
        }}
      />
      <Text variant="caption" color={belowRecommended ? colors.warning : colors.textMuted}>
        {belowRecommended
          ? t`Below ${minimumPercent}%, text is no longer guaranteed to stay readable`
          : t`Recommended minimum for readable text: ${minimumPercent}%`}
      </Text>
    </View>
  );
}
