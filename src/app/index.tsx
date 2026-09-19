import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';

import { useAppSettings } from '@/stores/app-settings';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { slotFontFamily } from '@/theme/user-font-file';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';
import {
  claimHomeWorkspaceHost,
  reconcileHomeWorkspaceOwner,
  releaseHomeWorkspaceHost,
} from '@/lib/home-workspace-owner';
import { HomeOverview } from '@/components/home-overview';
import { ServerTerminalWorkspace } from '@/components/server-terminal-workspace';

/** The phone/list presentation may refresh its scroll tree when fonts change. */
export default function HomeScreen() {
  const interfaceFont = useAppSettings((state) => state.interfaceFont);
  const monoFont = useAppSettings((state) => state.monoFont);
  const listPresentationKey = `${slotFontFamily(interfaceFont, 'interface') ?? 'system'}|${
    slotFontFamily(monoFont, 'mono') ?? 'system'
  }`;
  return <HomeScreenContent listPresentationKey={listPresentationKey} />;
}

function HomeScreenContent({ listPresentationKey }: { listPresentationKey: string }) {
  const { width } = useWindowDimensions();
  const { record, loading } = useGatewayRecord();
  const isFocused = useIsFocused();
  const sourceRouteActiveRef = useRef(false);
  const [routeActive, setRouteActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      sourceRouteActiveRef.current = true;
      setRouteActive(true);
      return () => {
        sourceRouteActiveRef.current = false;
        setRouteActive(false);
      };
    }, [])
  );
  const sourceRouteActive = useCallback(
    () => sourceRouteActiveRef.current && isFocused,
    [isFocused]
  );
  const workspaceLayout = responsiveWorkspaceLayout(width);
  const [workspaceOwnerServerId, setWorkspaceOwnerServerId] = useState<string | null>(null);
  const nextWorkspaceOwner = reconcileHomeWorkspaceOwner(workspaceOwnerServerId, {
    mode: workspaceLayout.mode,
    loading,
    serverId: record?.serverId,
    allowInitialActivation: isFocused && routeActive,
  });

  // Commit the lifetime decision after the current tree has been selected. A
  // layout transition can therefore render the already-owned workspace in the
  // same pass; it never briefly unmounts it while waiting for an effect.
  useLayoutEffect(() => {
    if (workspaceOwnerServerId === nextWorkspaceOwner) return;
    setWorkspaceOwnerServerId(nextWorkspaceOwner);
  }, [nextWorkspaceOwner, workspaceOwnerServerId]);

  useLayoutEffect(() => {
    if (!nextWorkspaceOwner) return;
    const token = claimHomeWorkspaceHost(nextWorkspaceOwner);
    return () => releaseHomeWorkspaceHost(token);
  }, [nextWorkspaceOwner]);

  // A ready Pad record activates the existing task owner. Once active, the
  // owner remains through compact/Pad resize; only a changed server identity
  // intentionally replaces its server-scoped workspace instance.
  if (nextWorkspaceOwner) {
    return (
      <ServerTerminalWorkspace
        key={nextWorkspaceOwner}
        serverId={nextWorkspaceOwner}
        sourceRouteActive={sourceRouteActive}
      />
    );
  }

  return (
    <ServerList
      key={listPresentationKey}
      listPresentationKey={listPresentationKey}
      width={width}
      layoutMode={workspaceLayout.mode}
      sourceRouteActive={sourceRouteActive}
    />
  );
}

function ServerList({
  width,
  layoutMode,
  listPresentationKey,
  sourceRouteActive,
}: {
  width: number;
  layoutMode: 'compact' | 'pad';
  listPresentationKey: string;
  sourceRouteActive: () => boolean;
}) {
  return (
    <HomeOverview
      key={listPresentationKey}
      width={width}
      layoutMode={layoutMode}
      embedded={false}
      sourceRouteActive={sourceRouteActive}
    />
  );
}
