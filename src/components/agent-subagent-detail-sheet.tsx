import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, Text } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { RefreshIcon } from '@/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentTranscriptList } from '@/components/agent-transcript-list';
import { ImagePreviewModal, type PreviewImage } from '@/components/image-preview-modal';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import {
  SheetSceneHeading,
  SheetSceneClose,
  SheetSceneAction,
  SheetSceneFooter,
  SheetSceneQuietControl,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { TRANSCRIPT_ROW_GAP, type AgentToolActions } from '@/components/agent-message-block';
import { demoAgentSessionSnapshot, demoAgentSessionTree, isDemoActive } from '@/lib/demo-gateway';
import {
  agentSubagentDetailContentState,
  agentSubagentDetailScopeKey,
  retainAgentSubagentDetail,
} from '@/lib/agent-subagent-detail';
import {
  getAgentSessionSnapshot,
  sessionTitleOr,
  type AgentSessionInfo,
  type AgentSessionSnapshot,
} from '@/lib/agent-session';
import { contextTokenTotal, formatModelName } from '@/lib/agent-protocol';
import { gatewayAuthHeaders, gatewayUrl, isGatewayConfigured } from '@/lib/gateway-client';
import { subagentSessionState } from '@/lib/agent-subagent-presentation';
import { subagentStateWord } from '@/i18n/labels';
import { createAgentTranscriptStore } from '@/stores/agent-transcript';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useToolCallDetailStore } from '@/stores/tool-call-detail';
import { useServerCapabilities } from '@/stores/server-capabilities';

import { SheetFrame } from '@/components/sheet-ground';
import { SheetHandle, useSheetIsFullscreen } from '@/components/sheet-route-frame';
import { useMeasuredSideInsets } from '@/hooks/use-side-insets';

const doNothing = () => {};

interface LoadedDetail {
  scopeKey: string;
  snapshot: AgentSessionSnapshot;
}

/**
 * A contextual, read-only snapshot of one descendant session.
 *
 * It deliberately owns neither a stream nor the workbench bridge. New output
 * cannot replace what the reader is looking at until they press Refresh, and a
 * slower request for the previous target cannot overwrite a replacement.
 */
export function AgentSubagentDetailSheet({
  sessionId,
  asid,
  fallbackInfo,
  onOpenChild,
}: {
  sessionId?: string;
  asid?: string;
  fallbackInfo?: AgentSessionInfo;
  onOpenChild: (asid: string) => void;
}) {
  const { t, i18n } = useLingui();
  const { colors } = useThemeTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const fullscreen = useSheetIsFullscreen();
  const side = useMeasuredSideInsets();
  const markdownStyle = usePaneChatMarkdownStyle();
  const serverId = useGatewayConnectionStore((state) => state.record?.serverId);
  const models = useAgentSheetBridge((state) => state.models);
  const ownerSessionId = useAgentSheetBridge((state) => state.sessionId);
  const showReasoning = useAgentSheetBridge((state) => state.showReasoning);
  const scopeKey = agentSubagentDetailScopeKey({ serverId, sessionId, ownerSessionId, asid });
  const [store] = useState(createAgentTranscriptStore);
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [preview, setPreview] = useState<{ scopeKey: string; uri: string } | null>(null);
  const [attempt, setAttempt] = useState<{ scopeKey: string; sequence: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  // react-doctor-disable-next-line react-doctor/no-set-state-after-await-in-effect -- requestRef and current() reject stale async results before every post-await update.
  useEffect(() => {
    const request = ++requestRef.current;
    // react-doctor-disable-next-line react-hooks-js/set-state-in-effect -- scope changes intentionally retain only a snapshot owned by the new target before loading it.
    setLoaded((current) => retainAgentSubagentDetail(current, scopeKey));
    setPreview((current) => retainAgentSubagentDetail(current, scopeKey));
    setLoading(true);
    setError('');

    if (!asid || (!sessionId && !isDemoActive())) {
      setLoading(false);
      setError(t`Session unavailable`);
      return;
    }

    const current = () => {
      if (request !== requestRef.current) return false;
      if (useGatewayConnectionStore.getState().record?.serverId !== serverId) return false;
      const currentOwnerSessionId = useAgentSheetBridge.getState().sessionId;
      return !ownerSessionId || currentOwnerSessionId === ownerSessionId;
    };

    const load = async () => {
      const demo = isDemoActive() ? demoAgentSessionSnapshot(asid) : null;
      const snapshot =
        demo ??
        (await getAgentSessionSnapshot(sessionId, asid, {
          refresh: attempt?.scopeKey === scopeKey,
          capabilities: serverId ? useServerCapabilities.getState().byServer[serverId] : undefined,
        }));
      if (!current()) return;
      const transcript = store.getState();
      transcript.configure({
        windowStart: 0,
        status: snapshot.info?.status,
      });
      transcript.setTimeline(snapshot.timeline, 0);
      setLoaded({ scopeKey, snapshot });
      setLoading(false);
    };

    void load().catch((failure) => {
      if (!current()) return;
      setError(failure instanceof Error ? failure.message : String(failure));
      setLoading(false);
    });

    return () => {
      if (requestRef.current === request) requestRef.current += 1;
    };
  }, [asid, attempt, ownerSessionId, scopeKey, serverId, sessionId, store, t]);

  const activeLoaded = retainAgentSubagentDetail(loaded, scopeKey);
  const activePreview = retainAgentSubagentDetail(preview, scopeKey);
  const previewImage = useCallback((uri: string) => setPreview({ scopeKey, uri }), [scopeKey]);
  const closePreview = useCallback(() => setPreview(null), []);
  // The same URI/auth path as workbench previews; data/local/external URLs
  // never inherit Gateway credentials. Scope masking precedes the load effect.
  const previewImages = useMemo<PreviewImage[] | null>(() => {
    if (!activePreview) return null;
    const { uri } = activePreview;
    return [
      {
        id: uri,
        uri,
        ...(isGatewayConfigured() && uri.startsWith(gatewayUrl('/'))
          ? { headers: gatewayAuthHeaders() }
          : {}),
      },
    ];
  }, [activePreview]);
  const info = activeLoaded?.snapshot.info ?? fallbackInfo;
  const title = info ? sessionTitleOr(info, t`Untitled session`) : t`Subagent`;
  const demoActive = isDemoActive();
  const actions = useMemo<AgentToolActions>(
    () => ({
      audioSessionId: asid,
      // A completed dispatch is not the child's status. Only the offline demo
      // supplies its known children here; non-demo snapshot actions are unchanged.
      ...(demoActive && asid
        ? {
            childSessions: Object.fromEntries(
              (demoAgentSessionTree().childrenByParent[asid] ?? []).map((child) => [
                child.asid,
                child,
              ])
            ),
          }
        : {}),
      onOpenChildSession: onOpenChild,
      onPreviewImage: previewImage,
      onOpenToolDetail: (part) => {
        useToolCallDetailStore.getState().open({
          part,
          sessionId,
          directory: info?.directory,
          transcript: store,
        });
        router.push('/agent-tool-detail');
      },
    }),
    [asid, demoActive, info?.directory, onOpenChild, previewImage, router, sessionId, store]
  );
  const rowProps = useMemo(
    () => ({
      showReasoning,
      markdownStyle,
      onPreviewImage: previewImage,
      onEditQueued: doNothing,
      onCancelQueued: doNothing,
      actions,
      readOnly: true,
    }),
    [actions, markdownStyle, previewImage, showReasoning]
  );
  const childModel = info?.model;
  const catalogName = models.find(
    (model) => model.id === childModel?.model_id && model.provider_id === childModel?.provider_id
  )?.name;
  const childModelName = formatModelName(childModel, '', catalogName);
  const hasSnapshot = activeLoaded !== null;
  const contentState = agentSubagentDetailContentState(hasSnapshot, loading, Boolean(error));

  const header = (
    <View style={[styles.header, { paddingTop: fullscreen ? insets.top : 0 }]}>
      <SheetHandle />
      <SheetSceneHeading
        title={t`Subagent`}
        caption={title}
        trailing={
          <>
            <SheetSceneQuietControl
              testID="agent-subagent-detail-refresh"
              accessibilityLabel={t`Refresh`}
              busy={loading}
              onPress={() =>
                setAttempt((value) => ({ scopeKey, sequence: (value?.sequence ?? 0) + 1 }))
              }>
              <RefreshIcon size={17} color={colors.textMuted} />
            </SheetSceneQuietControl>
            {fullscreen ? <SheetSceneClose /> : null}
          </>
        }
      />
      <View style={styles.metadata}>
        {info ? (
          <Text testID="agent-subagent-detail-status" variant="caption" color={colors.textMuted}>
            {i18n._(subagentStateWord[subagentSessionState(info)])}
          </Text>
        ) : null}
        {info?.agent_name || info?.agent_role ? (
          <Text variant="caption" color={colors.textMuted}>
            {[info.agent_name, info.agent_role].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {childModelName ? (
          <Text testID="agent-subagent-detail-model" variant="caption" color={colors.textMuted}>
            {t`Model`}: {childModelName}
          </Text>
        ) : null}
        {info?.tokens ? (
          <Text testID="agent-subagent-detail-tokens" variant="caption" color={colors.textMuted}>
            {t`Tokens this session`}: {contextTokenTotal(info.tokens).toLocaleString()}
          </Text>
        ) : null}
        {error && hasSnapshot ? (
          <Text
            testID="agent-subagent-detail-refresh-error"
            variant="caption"
            color={colors.danger}>
            {t`Could not load the session`}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <SheetFrame testID="agent-subagent-detail-sheet" tint="surface" frosted>
      <View
        collapsable={false}
        onLayout={side.onLayout}
        style={[styles.column, { paddingLeft: side.left, paddingRight: side.right }]}>
        {header}
        {contentState === 'loading' ? (
          <View testID="agent-subagent-detail-loading" style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : contentState === 'error' ? (
          <View testID="agent-subagent-detail-error" style={styles.center}>
            <Text variant="bodySmall" color={colors.textMuted} style={styles.message}>
              {t`Could not load the session`}
            </Text>
            <SheetSceneAction
              testID="agent-subagent-detail-retry"
              label={t`Try again`}
              onPress={() =>
                setAttempt((value) => ({ scopeKey, sequence: (value?.sequence ?? 0) + 1 }))
              }
            />
          </View>
        ) : (
          <AgentTranscriptList
            keyboardAware={false}
            nestedScrollEnabled
            testID="agent-subagent-detail-transcript"
            store={store}
            rowProps={rowProps}
            dataKey={asid}
            alignItemsAtEnd={false}
            initialScrollAtEnd
            maintainScrollAtEnd={false}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text variant="bodySmall" color={colors.textMuted}>
                  {t`No output yet.`}
                </Text>
              </View>
            }
            ListFooterComponent={<SheetSceneFooter bottomInset={insets.bottom} />}
            style={sheetSceneStyles.scroller}
            contentContainerStyle={styles.transcriptContent}
          />
        )}
      </View>
      {previewImages ? (
        <ImagePreviewModal
          key={scopeKey}
          images={previewImages}
          initialIndex={0}
          onClose={closePreview}
        />
      ) : null}
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, minHeight: 0 },
  header: { paddingHorizontal: 20 },
  metadata: { gap: 4, paddingBottom: 16 },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 14,
  },
  message: { textAlign: 'center' },
  empty: { paddingVertical: 24, alignItems: 'center' },
  transcriptContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: TRANSCRIPT_ROW_GAP,
  },
});
