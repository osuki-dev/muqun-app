import { memo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';

import { AgentMark } from '@/components/agent-mark';
import { PressableScale } from '@/components/pressable-scale';
import { SheetSceneGroupHeading } from '@/components/sheet-scene';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { useSessionContentSearch } from '@/hooks/use-session-content-search';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  snippetSegments,
  type ServerSessionSearchHit,
  type SessionSearchGroup,
} from '@/lib/session-search';

/**
 * "In messages": what a search finds inside sessions, under the instant
 * title matches. Owns its query to the gateways, so typing re-renders this
 * section and not the list above it.
 */
export const SessionContentSearch = memo(function SessionContentSearch({
  records,
  query,
  agentId,
  directory,
  computerLabels,
  titleMatches,
  onOpenHit,
  surface = 'ground',
  testID = 'session-content-search',
}: {
  /** The computers to ask; only ones with `session_search_v1`. Empty hides the section. */
  records: readonly GatewayRecord[];
  query: string;
  agentId?: string;
  directory?: string;
  /** Names each hit's computer; omitted when only one is searched. */
  computerLabels?: Readonly<Record<string, string>>;
  /** How many sessions the title filter above already shows. */
  titleMatches: number;
  onOpenHit: (hit: ServerSessionSearchHit) => void;
  /** `card`: on Home's sessions card fill; `ground`: on the sheet's own ground. */
  surface?: 'card' | 'ground';
  testID?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const result = useSessionContentSearch({ records, query, agentId, directory });
  if (result.idle) return null;
  const { groups, indexing, loading, failed } = result;
  const allFailed = !loading && failed.length > 0 && failed.length === records.length;
  const meta = loading ? (
    <ActivityIndicator size="small" color={theme.colors.textMuted} />
  ) : indexing ? (
    <Text testID={`${testID}-indexing`} variant="caption" color={theme.colors.textMuted}>
      {t`Indexing ${indexing.done}/${indexing.total}`}
    </Text>
  ) : null;
  const empty = !loading && !allFailed && groups.length === 0;
  return (
    <View testID={testID} style={styles.root}>
      <SheetSceneGroupHeading title={t`In messages`} meta={meta} />
      {allFailed ? (
        <Text variant="caption" color={theme.colors.danger} style={styles.note}>
          {t`Could not search messages`}
        </Text>
      ) : empty ? (
        <Text
          testID={`${testID}-empty`}
          variant="caption"
          color={theme.colors.textMuted}
          style={styles.note}>
          {titleMatches === 0 ? t`No sessions or messages match` : t`No messages match`}
        </Text>
      ) : groups.length ? (
        <View
          style={[
            styles.list,
            surface === 'card' && {
              backgroundColor: background(theme.colors.surface),
              borderRadius: profile.chrome.surface,
            },
          ]}>
          {groups.map((group, index) => (
            <ContentSearchGroup
              key={group.key}
              group={group}
              computer={computerLabels?.[group.serverId]}
              separated={index > 0}
              inset={surface === 'card'}
              onOpenHit={onOpenHit}
            />
          ))}
        </View>
      ) : null}
      {!allFailed && failed.length > 0 && !loading ? (
        <Text variant="caption" color={theme.colors.textMuted} style={styles.note}>
          {t`Some computers could not be searched`}
        </Text>
      ) : null}
    </View>
  );
});

function ContentSearchGroup({
  group,
  computer,
  separated,
  inset,
  onOpenHit,
}: {
  group: SessionSearchGroup;
  computer?: string;
  separated: boolean;
  inset: boolean;
  onOpenHit: (hit: ServerSessionSearchHit) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const first = group.hits[0];
  const title = first.title.trim() || t`Untitled session`;
  const more = group.more;
  return (
    <View
      testID={`session-content-group-${first.asid}`}
      style={[
        styles.group,
        inset && styles.inset,
        separated && {
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      ]}>
      <View style={styles.titleLine}>
        <View style={styles.titleMark}>
          <AgentMark kind={first.agentId} size={14} color={theme.colors.primary} />
        </View>
        <Text variant="bodySmall" weight="semibold" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {computer ? (
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {computer}
          </Text>
        ) : null}
      </View>
      {group.hits.map((hit) => (
        <ContentSearchHit key={hit.itemId} hit={hit} title={title} onOpen={onOpenHit} />
      ))}
      {more > 0 ? (
        <Text variant="caption" color={theme.colors.textMuted} style={styles.more}>
          {t`+${more} more in this session`}
        </Text>
      ) : null}
    </View>
  );
}

function ContentSearchHit({
  hit,
  title,
  onOpen,
}: {
  hit: ServerSessionSearchHit;
  title: string;
  onOpen: (hit: ServerSessionSearchHit) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const relativeTime = useRelativeTime();
  const who = hit.kind === 'tool' ? t`Tool` : hit.role === 'user' ? t`You` : t`Agent`;
  const when = relativeTime(hit.timeMs);
  return (
    <PressableScale
      testID={`session-content-hit-${hit.itemId}`}
      accessibilityRole="button"
      accessibilityLabel={t`Open ${title} at: ${hit.snippet}`}
      onPress={() => onOpen(hit)}
      style={styles.hit}>
      <Text variant="bodySmall" color={theme.colors.textMuted} numberOfLines={3}>
        {snippetSegments(hit.snippet, hit.highlights).map((segment, index) =>
          segment.hit ? (
            <Text
              // oxlint-disable-next-line react/no-array-index-key -- segments are positional cuts of one immutable snippet
              key={index}
              variant="bodySmall"
              weight="semibold"
              color={theme.colors.text}
              style={{ backgroundColor: theme.colors.primarySubtle }}>
              {segment.text}
            </Text>
          ) : (
            segment.text
          )
        )}
      </Text>
      <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
        {when ? `${who} · ${when}` : who}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { minWidth: 0 },
  list: { minWidth: 0, overflow: 'hidden' },
  note: { paddingVertical: 8 },
  group: { paddingVertical: 10, gap: 6 },
  inset: { paddingHorizontal: 12 },
  titleLine: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleMark: { height: 20, justifyContent: 'center' },
  title: { minWidth: 0, flex: 1 },
  hit: { gap: 2, paddingVertical: 4, paddingLeft: 20 },
  more: { paddingLeft: 20 },
});
