import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { ComputerIcon, CloseIcon } from '@/icons';
import { AgentActionMenu } from './agent-action-menu';
import { loadGateways } from '@/lib/gateway-storage';
import { useLatestReader } from '@/hooks/use-render-refs';
import {
  FileComputerSelection,
  resolveAgentFileAsset,
  resolveComputerFile,
} from '@/lib/gateway-client';

const FileResolver = createContext<typeof resolveAgentFileAsset>(resolveAgentFileAsset);
type Choice = {
  scopeKey: string;
  path: string;
  computers: { serverId: string; label: string }[];
  finish: (serverId: string | null) => void;
};

function requireFileSelectionScope(scopeKey: string, readScope: () => string, signal: AbortSignal) {
  if (signal.aborted || readScope() !== scopeKey) throw new Error('Operation cancelled');
}

function cancelFileSelections(pending: Map<() => void, string>, scopeKey: string) {
  for (const [cancel, owner] of pending) if (owner === scopeKey) cancel();
}

/** Displays a Gateway-requested choice; path resolution and authorization stay on the host. */
export function FileComputerPicker({
  children,
  scopeKey = '',
}: {
  children: ReactNode;
  scopeKey?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending] = useState(() => new Map<() => void, string>());
  const readScope = useLatestReader(scopeKey);
  const activeChoice = choice?.scopeKey === scopeKey ? choice : null;
  useEffect(() => () => cancelFileSelections(pending, scopeKey), [pending, scopeKey]);

  async function resolve(
    ...[asid, uri, signal, serverId]: Parameters<typeof resolveAgentFileAsset>
  ): ReturnType<typeof resolveAgentFileAsset> {
    requireFileSelectionScope(scopeKey, readScope, signal);
    try {
      const asset = await resolveAgentFileAsset(asid, uri, signal, serverId);
      requireFileSelectionScope(scopeKey, readScope, signal);
      return asset;
    } catch (error) {
      requireFileSelectionScope(scopeKey, readScope, signal);
      if (!(error instanceof FileComputerSelection) || signal.aborted) throw error;
      const gateways = await loadGateways();
      requireFileSelectionScope(scopeKey, readScope, signal);
      const computers = gateways
        .filter((record) => record.serverId !== serverId)
        .map(({ serverId: id, label }) => ({ serverId: id, label }));
      if (!computers.length) throw new Error(t`No other paired computer is available.`);
      if (signal.aborted) throw new Error('Operation cancelled');
      const path = error.path;
      const selected = await new Promise<string>((accept, reject) => {
        for (const previous of pending.keys()) previous();
        const finish = (id: string | null) => {
          signal.removeEventListener('abort', cancel);
          pending.delete(cancel);
          setChoice((current) => (current?.finish === finish ? null : current));
          if (id && !signal.aborted && readScope() === scopeKey) accept(id);
          else reject(new Error('Operation cancelled'));
        };
        const cancel = () => finish(null);
        pending.set(cancel, scopeKey);
        signal.addEventListener('abort', cancel, { once: true });
        setChoice({ scopeKey, path, computers, finish });
      });
      requireFileSelectionScope(scopeKey, readScope, signal);
      const asset = await resolveComputerFile(path, selected, signal);
      requireFileSelectionScope(scopeKey, readScope, signal);
      return asset;
    }
  }

  return (
    <FileResolver.Provider value={resolve}>
      {children}
      <Modal
        visible={activeChoice !== null}
        transparent
        animationType="fade"
        onRequestClose={() => activeChoice?.finish(null)}>
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
              {activeChoice?.path}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <AgentActionMenu
                surface="ground"
                items={[
                  ...(activeChoice?.computers.map((computer) => ({
                    id: computer.serverId,
                    label: computer.label,
                    Icon: ComputerIcon,
                    onPress: () => activeChoice.finish(computer.serverId),
                  })) ?? []),
                  {
                    id: 'cancel',
                    label: t`Cancel`,
                    Icon: CloseIcon,
                    onPress: () => activeChoice?.finish(null),
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
