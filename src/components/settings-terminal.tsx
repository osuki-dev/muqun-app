/**
 * What a terminal pane does when it opens, and what sits above the keyboard.
 *
 * Second on the page after the servers, because this is the section a returning
 * reader actually comes back for: everything in it is about the surface they
 * spend the session looking at. It reads its own store slices, so nothing else
 * on the page re-renders when a size changes.
 */
import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { type Href, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';

import {
  SettingsBlock,
  SettingsNavRow,
  SettingsSection,
  SettingsToggleRow,
} from '@/components/settings-chrome';
import { SettingsSegmented } from '@/components/settings-segmented';
import { paneViewModeDetail, paneViewModeFallback, paneViewModeLabel } from '@/i18n/labels';
import {
  AGENT_DEFAULT_VIEW_SETTING_ENABLED,
  CHAT_VIEW_ENABLED,
  type PaneViewMode,
} from '@/lib/pane-view-mode';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings, type TerminalTextSize } from '@/stores/app-settings';

export function SettingsTerminal({ title }: { title: string }) {
  const { t } = useLingui();
  // The runtime `_`, for the message descriptors in `@/i18n/labels`. Same
  // reason as `t`: it comes from the context, so React Compiler can see it
  // change.
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const router = useRouter();
  useRenderTally('SettingsTerminal');

  const agentDefaultView = useAppSettings((state) => state.agentDefaultView);
  const showTerminalKeyRow = useAppSettings((state) => state.showTerminalKeyRow);
  const terminalTextSize = useAppSettings((state) => state.terminalTextSize);
  const update = useAppSettings((state) => state.update);

  return (
    <SettingsSection title={title}>
      <SettingsToggleRow
        label={t`Terminal key row`}
        detail={t`Show Esc, Tab, Ctrl and navigation keys above input.`}
        value={showTerminalKeyRow}
        onValueChange={(value) => void update({ showTerminalKeyRow: value })}
      />
      {/* Behind a flag rather than deleted: the setting still works and still
          decides what a pane opens in, it is just no longer asked about here.
          Switching a view is a decision about the pane you are looking at, and
          both places that offer it -- the pane header and quick actions -- are
          already in front of that pane. */}
      {AGENT_DEFAULT_VIEW_SETTING_ENABLED ? (
        <SettingsBlock
          // Only the starting point. Each pane remembers what it was last
          // switched to with the button in its own header, and a pane the
          // gateway cannot normalize opens on the terminal whatever this says
          // -- so this is a default, not a mode.
          label={t`Agent panes open in`}
          caption={
            <Text variant="caption" color={theme.colors.textSubtle}>
              {_(paneViewModeDetail[paneViewModeFallback(agentDefaultView)])}
            </Text>
          }>
          <SettingsSegmented
            // The chat option follows the same flag as the header cycle, so
            // hiding the view hides it everywhere at once.
            options={[
              ...(CHAT_VIEW_ENABLED ? [{ label: _(paneViewModeLabel.chat), value: 'chat' }] : []),
              { label: _(paneViewModeLabel.text), value: 'text' },
              { label: _(paneViewModeLabel.terminal), value: 'terminal' },
            ]}
            value={agentDefaultView}
            onChange={(value) => void update({ agentDefaultView: value as PaneViewMode })}
          />
        </SettingsBlock>
      ) : null}
      <SettingsBlock label={t`Text size`}>
        <SettingsSegmented
          options={[
            { label: t`Compact`, value: 'compact' },
            { label: t`Default`, value: 'default' },
            { label: t`Large`, value: 'large' },
          ]}
          value={terminalTextSize}
          onChange={(value) => void update({ terminalTextSize: value as TerminalTextSize })}
        />
      </SettingsBlock>
      {/* No glyph: every other row in this card is a switch or a segmented
          control, and one chipped row among them puts a single label 52 points
          right of the rest. The rule is per card -- see `SettingsNavRow`. */}
      <SettingsNavRow
        trailing={ChevronRight}
        label={t`Quick actions`}
        detail={t`Add commands and custom key combinations.`}
        onPress={() => router.push('/commands?mode=terminal&manage=1' as Href)}
      />
    </SettingsSection>
  );
}
