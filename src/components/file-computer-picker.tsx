import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { ComputerIcon, CloseIcon } from '@/icons';
import { AgentActionMenu } from './agent-action-menu';
import { loadGateways } from '@/lib/gateway-storage';
import {
  FileComputerSelection,
  resolveAgentFileAsset,
  resolveComputerFile,
} from '@/lib/gateway-client';

const FileResolver = createContext<typeof resolveAgentFileAsset>(resolveAgentFileAsset);
type Choice = {
  path: string;
  computers: { serverId: string; label: string }[];
  finish: (serverId: string | null) => void;
};

/** Displays a Gateway-requested choice; path resolution and authorization stay on the host. */
export function FileComputerPicker({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending] = useState(() => new Set<() => void>());
  useEffect(
    () => () => {
      for (const cancel of pending) cancel();
    },
    [pending]
  );

  const resolve: typeof resolveAgentFileAsset = async (asid, uri, signal, serverId) => {
    try {
      return await resolveAgentFileAsset(asid, uri, signal, serverId);
    } catch (error) {
      if (!(error instanceof FileComputerSelection) || signal.aborted) throw error;
      const computers = (await loadGateways())
        .filter((record) => record.serverId !== serverId)
        .map(({ serverId: id, label }) => ({ serverId: id, label }));
      if (!computers.length) throw new Error(t`No other paired computer is available.`);
      if (signal.aborted) throw new Error('Operation cancelled');
      const path = error.path;
      const selected = await new Promise<string>((accept, reject) => {
        for (const previous of pending) previous();
        const finish = (id: string | null) => {
          signal.removeEventListener('abort', cancel);
          pending.delete(cancel);
          setChoice((current) => (current?.finish === finish ? null : current));
          if (id && !signal.aborted) accept(id);
          else reject(new Error('Operation cancelled'));
        };
        const cancel = () => finish(null);
        pending.add(cancel);
        signal.addEventListener('abort', cancel, { once: true });
        setChoice({ path, computers, finish });
      });
      return resolveComputerFile(path, selected, signal);
    }
  };

  return (
    <FileResolver.Provider value={resolve}>
      {children}
      <Modal
        visible={choice !== null}
        transparent
        animationType="fade"
        onRequestClose={() => choice?.finish(null)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0008' }}>
          <View
            testID="file-computer-picker"
            style={{
              padding: 20,
              borderRadius: 20,
              backgroundColor: theme.colors.background,
              maxWidth: 520,
              width: '100%',
              alignSelf: 'center',
            }}>
            <Text style={{ fontSize: 20 }}>{t`Open from computer`}</Text>
            <Text numberOfLines={3} style={{ marginVertical: 12 }}>
              {choice?.path}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <AgentActionMenu
                surface="ground"
                items={[
                  ...(choice?.computers.map((computer) => ({
                    id: computer.serverId,
                    label: computer.label,
                    Icon: ComputerIcon,
                    onPress: () => choice.finish(computer.serverId),
                  })) ?? []),
                  {
                    id: 'cancel',
                    label: t`Cancel`,
                    Icon: CloseIcon,
                    onPress: () => choice?.finish(null),
                  },
                ]}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </FileResolver.Provider>
  );
}

export function useFileResolver() {
  return useContext(FileResolver);
}
