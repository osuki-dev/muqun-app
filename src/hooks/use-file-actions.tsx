import { useLingui } from '@lingui/react/macro';
import { Modal, Text, useToast, type ToastController } from '@osuki-dev/ui';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useRef, useState } from 'react';
import { NearestToasts } from '@/components/app-toast-provider';
import { DownloadIcon, CloseIcon } from '@/icons';
import { AgentActionMenu } from '@/components/agent-action-menu';
import { AudioPlaybackError } from '@/lib/audio-playback-session';

/** File actions float above content so a long press never reflows the transcript. */
export function useFileActions(name: string, save: () => Promise<unknown>, image = false) {
  const { t } = useLingui();
  const rootToasts = useToast();
  // The viewers that own this hook draw `menu` inside their own `Modal` window,
  // which covers the root's toasts; `NearestToasts` points at that window's.
  const nearestToasts = useRef<ToastController | null>(null);
  const showToast: ToastController['showToast'] = (toast) =>
    (nearestToasts.current ?? rootToasts).showToast(toast);
  const profile = useAppearanceProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setOpen(false);
    setBusy(true);
    void save()
      .then((folder) => {
        // Only Android names the folder it wrote into.
        if (typeof folder === 'string')
          showToast({ variant: 'success', message: t({ message: `Saved to ${folder}` }) });
      })
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
    menu: (
      <>
        <NearestToasts
          onChange={(toasts) => {
            nearestToasts.current = toasts;
          }}
        />
        {open ? (
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
                    Icon: DownloadIcon,
                    onPress: run,
                    testID: 'file-actions-save',
                  },
                  {
                    id: 'cancel',
                    label: t`Cancel`,
                    Icon: CloseIcon,
                    onPress: () => setOpen(false),
                  },
                ]}
              />
            </Modal.Content>
          </Modal.Root>
        ) : null}
      </>
    ),
  };
}
