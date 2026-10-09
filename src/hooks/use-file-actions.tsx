import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useState } from 'react';
import { View } from 'react-native';
import { Download, X } from 'lucide-react-native';
import { AgentActionMenu } from '@/components/agent-action-menu';
import { Text } from '@/components/text';
import { AudioPlaybackError } from '@/lib/audio-playback-session';

/** Uses the same themed action menu as transcript and attachment controls. */
export function useFileActions(name: string, save: () => Promise<void>, image = false) {
  const { t } = useLingui();
  const { showToast } = useToast();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setOpen(false);
    setBusy(true);
    void save()
      .catch((error: unknown) => {
        if (!(error instanceof Error) || !/cancel/i.test(error.message))
          showToast({
            variant: 'danger',
            title: t`Could not save file`,
            message:
              error instanceof AudioPlaybackError
                ? t`Update the Gateway to open or save this file.`
                : t`Try again`,
          });
      })
      .then(() => setBusy(false));
  };
  return {
    show: () => {
      if (!busy) setOpen((value) => !value);
    },
    menu: open ? (
      <View
        style={{
          gap: 8,
          padding: 12,
          borderRadius: profile.chrome.popover,
          backgroundColor: theme.colors.surface,
        }}>
        <Text variant="caption" numberOfLines={1}>
          {name}
        </Text>
        <AgentActionMenu
          surface="ground"
          testID="file-actions-menu"
          items={[
            {
              id: 'save',
              label: image ? t`Save image` : t`Save file`,
              Icon: Download,
              onPress: run,
              testID: 'file-actions-save',
            },
            { id: 'cancel', label: t`Cancel`, Icon: X, onPress: () => setOpen(false) },
          ]}
        />
      </View>
    ) : null,
  };
}
