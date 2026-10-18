import { useLingui } from '@lingui/react/macro';
import { Modal, Text, useToast } from '@osuki-dev/ui';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useState } from 'react';
import { Download, X } from 'lucide-react-native';
import { AgentActionMenu } from '@/components/agent-action-menu';
import { AudioPlaybackError } from '@/lib/audio-playback-session';

/** File actions float above content so a long press never reflows the transcript. */
export function useFileActions(name: string, save: () => Promise<void>, image = false) {
  const { t } = useLingui();
  const { showToast } = useToast();
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
      <Modal.Root open onOpenChange={(value) => setOpen(value)}>
        <Modal.Content
          closeLabel={t`Cancel`}
          contentStyle={{
            borderWidth: 0,
            borderRadius: profile.chrome.popover,
            maxWidth: 320,
            padding: 12,
            gap: 4,
          }}>
          <Text variant="caption" numberOfLines={1} style={{ paddingHorizontal: 14 }}>
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
        </Modal.Content>
      </Modal.Root>
    ) : null,
  };
}
