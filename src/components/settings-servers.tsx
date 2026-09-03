import { Trans, useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Input, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { useFocusEffect } from 'expo-router';
import { Check, ChevronDown, Pencil, Trash2 } from 'lucide-react-native';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import {
  LADDER,
  SettingsBlock,
  SettingsSection,
  SettingsSeparator,
} from '@/components/settings-chrome';
import { SettingsSegmented } from '@/components/settings-segmented';
import { StatusDot } from '@/components/status-dot';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { reachabilityDescription, reachabilityLabel } from '@/i18n/labels';
import { DEMO_SERVER_ID } from '@/lib/demo-gateway';
import { feedback } from '@/lib/feedback';
import {
  loadPairedDevices,
  revokePairedDevice,
  type PairedDevice,
} from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { fadeIn, fadeOut, listLayout, timing } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { describeGatewayFailure } from '@/lib/network-error';
import { normalizeGatewayUrl } from '@/lib/pairing';
import { reachabilityFromProbe, type ServerReachability } from '@/lib/server-reachability';
import { useAppSettings, type ServerCardPanes } from '@/stores/app-settings';
import { useServerAgents } from '@/stores/server-agents';
import { useServerReachability } from '@/stores/server-reachability';
import type { ServerAgentsSnapshot } from '@/lib/server-agents';

/**
 * The full account of every paired server, and the one preference about how
 * they are drawn elsewhere. First on the settings page, because it is the
 * subject the app is about: a reader who opens Settings is far more often
 * asking "which machine am I on, and what is its address" than "what colour is
 * this".
 *
 * The home screen deliberately says less: a card there carries a name, a light
 * and the agents that were running, and it prints an address only when a second
 * machine answers to the same name (`lib/server-address.ts`). This is where the
 * rest of it lives -- every address, always; which server the app is currently
 * attached to; and the switch, the device list and the unpair for each one.
 *
 * `Panes on server cards` used to be a section of its own, one row long,
 * titled `Home screen`, sitting directly under this list with a comment
 * apologising for it. It is a preference about how *this* list is drawn on the
 * other screen, so it is in here now, under the thing it describes -- and it
 * used to be a plain on/off (`Show agents on server cards`), which answered
 * the wrong question: a card never had a reason to show nothing, only a
 * reason to show a narrower or a wider slice of the same session.
 *
 * Nothing here is a second implementation of anything. Selecting and removing
 * go through `useGatewayRecord`; the status comes from the same reachability
 * store and the same words as the home card's light; the device list is the
 * block that used to sit, untranslated and unattached, under Security.
 *
 * Editing joins them for the same reason: a name, an address and a port are
 * all properties of *this* record, so changing any of them is a write through
 * `useGatewayRecord().editRecord`, not a new code path. It is also why the
 * home card's `...` menu is gone -- rename and unpair used to live there
 * *and* here, two places for the same two actions, agreeing only because
 * nobody had renamed a card in a while. Now there is one place, and it is
 * this one, because a server's whole account -- what it is called, where it
 * lives, whether it should stay paired -- already belongs on this screen.
 */
export function SettingsServers({ title }: { title: string }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  useRenderTally('SettingsServers');

  const theme = useThemeTokens();
  const { showToast } = useToast();
  const { record, records, loading, selectRecord, removeRecord } = useGatewayRecord();
  const probes = useServerReachability((state) => state.probes);
  const refreshReachability = useServerReachability((state) => state.refresh);
  const serverCardPanes = useAppSettings((state) => state.serverCardPanes);
  const update = useAppSettings((state) => state.update);
  // The one piece of history a record the app is not attached to still has:
  // the last time `/servers/[serverId]` actually heard back from it, mirrored
  // to disk for the home screen's agent chips (`stores/server-agents.ts`).
  // "Unknown" and "never once answered" read as the same hollow dot on this
  // screen otherwise, and they are not the same fact -- a dead pairing from a
  // gateway that no longer exists deserves to look different from a real
  // machine that is simply asleep right now.
  const agentsByServer = useServerAgents((state) => state.byServer);
  const hydrateServerAgents = useServerAgents((state) => state.hydrate);
  useEffect(() => {
    void hydrateServerAgents();
  }, [hydrateServerAgents]);
  // One row is open at a time. Two open rows on a settings screen is a list of
  // panels rather than a list of servers, and only one of them can ever be the
  // one in use anyway.
  const [openId, setOpenId] = useState<string | null>(null);

  // The same question the home screen asks, asked the same way: only of the
  // server the app is already configured for, because every other record's
  // token would have to go on the wire to answer it. See
  // `stores/server-reachability.ts`.
  useFocusEffect(
    useCallback(() => {
      if (!record || record.serverId === DEMO_SERVER_ID) return;
      void refreshReachability({
        serverId: record.serverId,
        url: record.url,
        token: record.token,
        deviceId: record.deviceId,
        transportKey: record.transportKey,
        transport: record.transport,
      });
    }, [record, refreshReachability])
  );

  async function use(server: GatewayRecord) {
    if (server.serverId === record?.serverId) return;
    await selectRecord(server.serverId);
    await feedback('selection');
  }

  async function unpair(server: GatewayRecord) {
    setOpenId(null);
    try {
      await removeRecord(server.serverId);
      await feedback('success');
    } catch (error) {
      showToast({
        variant: 'danger',
        title: t`Could not unpair server`,
        message: describeGatewayFailure(
          error,
          t`The server was kept on this device. Make sure its Gateway is running, then try again.`
        ).message,
      });
    }
  }

  return (
    <SettingsSection title={title}>
      {loading ? (
        <View style={styles.note}>
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Loading servers</Trans>
          </Text>
        </View>
      ) : records.length === 0 ? (
        <View style={styles.note}>
          <Text variant="bodySmall">
            <Trans>No servers paired yet</Trans>
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Use the scan button on the home screen to add one.</Trans>
          </Text>
        </View>
      ) : (
        <View>
          {records.map((server, index) => {
            const current = server.serverId === record?.serverId;
            return (
              <Fragment key={server.serverId}>
                {index > 0 ? <SettingsSeparator /> : null}
                <ServerRow
                  server={server}
                  current={current}
                  reachability={
                    current
                      ? reachabilityFromProbe(probes[server.serverId])
                      : // A record the app is not attached to has not been
                        // asked, and "never asked" is not "offline". The home
                        // screen draws the same distinction with a hollow dot.
                        'unknown'
                  }
                  lastConnected={current ? undefined : agentsByServer[server.serverId]}
                  open={openId === server.serverId}
                  onToggle={() =>
                    setOpenId((id) => (id === server.serverId ? null : server.serverId))
                  }
                  onUse={() => void use(server)}
                  onUnpair={() => void unpair(server)}
                />
              </Fragment>
            );
          })}
        </View>
      )}

      {/* The preference that governs how the home screen draws this same list,
          under the list it is about rather than in a one-row section of its
          own further down the page.

          A choice with two named states, not a switch: "on" and "off" answer
          "show anything at all", which is not the question here -- a card
          always lists something, and what changed under the owner's own
          machine was that a tmux window/pane and a herdr tab/pane are the
          same concept, so filtering to "agents" was hiding windows that were
          just as reachable as the ones running one. */}
      <SettingsBlock
        label={t`Panes on server cards`}
        caption={
          <Text variant="caption" color={theme.colors.textSubtle}>
            {serverCardPanes === 'all'
              ? t`List every pane, agent or not.`
              : t`List only the panes running a recognised agent.`}
          </Text>
        }>
        <SettingsSegmented
          options={[
            { label: t`Agents`, value: 'agents' },
            { label: t`All panes`, value: 'all' },
          ]}
          value={serverCardPanes}
          onChange={(value) => void update({ serverCardPanes: value as ServerCardPanes })}
        />
      </SettingsBlock>
    </SettingsSection>
  );
}

/**
 * One paired machine, and the drawer of things that can be done to it.
 *
 * A component rather than an inline block, which is what makes opening one row
 * cost one row: `openId` lives on the list, but the only rows that re-render
 * when it moves are the one closing and the one opening.
 *
 * Two things animate, and both of them are the same state change seen twice.
 * The chevron turns over on the `short` token instead of jumping 180 degrees
 * between frames, and the drawer fades as it grows and fades as it goes -- it
 * used to appear and vanish outright, which is the one thing the app's motion
 * rules forbid outright ("every entrance has an exit").
 */
function ServerRow({
  server,
  current,
  reachability,
  lastConnected,
  open,
  onToggle,
  onUse,
  onUnpair,
}: {
  server: GatewayRecord;
  /** The server the app is attached to, which is the one with a device list. */
  current: boolean;
  reachability: ServerReachability;
  /**
   * What `/servers/[serverId]` last mirrored for this record, or `undefined`
   * for `current` -- the live probe already says everything worth saying
   * about the server the app is attached to. For every other record this is
   * the only history there is: a snapshot with no entry means this pairing
   * has never once heard back.
   */
  lastConnected: ServerAgentsSnapshot | undefined;
  open: boolean;
  onToggle: () => void;
  onUse: () => void;
  onUnpair: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  useRenderTally('SettingsServerRow');

  /**
   * The rough bucket a record's last confirmed answer falls into.
   *
   * Deliberately as rough as `PairedDevices`' own `lastSeen` further down, and
   * for the same reason: nobody acts on the exact second, and a precise
   * timestamp invites reading it as one. A sibling function rather than a
   * shared one, because the two open on a different word -- "Last seen" is a
   * device asking the gateway about itself, "Last connected" is this app
   * asking about the gateway -- and forcing one template to serve both would
   * be fixing an accidental collision, not a real one.
   *
   * Nested inside the component on purpose, exactly like `lastSeen`: the
   * `useLingui` macro only rewrites a `t` template in the scope that declared
   * it, and a `t` arriving as a parameter is a different binding the macro
   * leaves untouched -- see `i18n/__tests__/macro-expansion.test.ts`.
   */
  function lastConnectedText(checkedAtMs: number, nowMs: number): string {
    const seconds = Math.max(0, Math.round((nowMs - checkedAtMs) / 1000));
    if (seconds < 60) return t`Last connected just now`;
    const minutes = Math.floor(seconds / 60);
    if (seconds < 3600) return t`Last connected ${minutes}m ago`;
    const hours = Math.floor(seconds / 3600);
    if (seconds < 86400) return t`Last connected ${hours}h ago`;
    const days = Math.floor(seconds / 86400);
    return t`Last connected ${days}d ago`;
  }

  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, timing('short'));
  }, [open, turn]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  const statusColor = reachability === 'live' ? theme.colors.success : theme.colors.textSubtle;
  // Read at render, like `PairedDevices`' own `nowMs` below: "last connected"
  // is relative to *now*, and a value captured once in state would go stale
  // the moment the row sat open for a minute.
  // oxlint-disable-next-line react/purity -- deliberate: see above.
  const nowMs = Date.now();

  return (
    <Animated.View layout={listLayout()} style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Options for ${server.label}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.rowHeader}>
        <View style={styles.rowCopy}>
          <View style={styles.nameLine}>
            <Text variant="bodySmall" numberOfLines={1} style={styles.name}>
              {server.label}
            </Text>
            {/* The only chip on the screen, and it marks the one fact a list of
                servers has to answer first: which of these is the app talking
                to. */}
            {current ? (
              <View style={[styles.usingChip, { backgroundColor: theme.colors.primarySubtle }]}>
                <Text variant="caption" color={theme.colors.primary} style={styles.usingText}>
                  <Trans>USING</Trans>
                </Text>
              </View>
            ) : null}
          </View>
          {/* Always, unlike the home card. This is the screen a reader comes to
              when the address is what they are after. */}
          <Text selectable variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
            {server.url}
          </Text>
          <View
            accessibilityLabel={_(reachabilityDescription[reachability])}
            style={styles.statusLine}>
            <StatusDot
              color={statusColor}
              filled={reachability !== 'unknown'}
              pulse={reachability === 'live'}
            />
            <Text variant="caption" color={statusColor} style={styles.statusText}>
              {_(reachabilityLabel[reachability])}
            </Text>
          </View>
          {/* Only for a record the list just called `unknown` about -- `current`
              is covered by the live probe above, and there is nothing this line
              could add to `live` or `offline` that the dot has not already
              said. This is the fact the probe cannot reach: not "is it up right
              now" but "has this pairing ever once worked", which is what tells
              a real machine that is merely asleep apart from a dead pairing
              nothing will ever revive. */}
          {!current ? (
            <Text variant="caption" color={theme.colors.textSubtle} style={styles.historyText}>
              {lastConnected
                ? lastConnectedText(lastConnected.checkedAtMs, nowMs)
                : t`Never connected`}
            </Text>
          ) : null}
        </View>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={18} color={theme.colors.textMuted} />
        </Animated.View>
      </PressableScale>

      {open ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          layout={listLayout()}
          style={styles.actions}>
          {current ? (
            <PairedDevices server={server} />
          ) : (
            <>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Use ${server.label}`}
                feedback="selection"
                onPress={onUse}
                style={[styles.action, { backgroundColor: theme.colors.primarySubtle }]}>
                <Check size={16} color={theme.colors.primary} strokeWidth={2.2} />
                <Text variant="caption" color={theme.colors.primary}>
                  <Trans>Use this server</Trans>
                </Text>
              </PressableScale>
              {/* Said rather than hidden: the device list is missing for a
                  reason, and a row that silently offers one server more than
                  another is a bug the reader has to guess at. */}
              <Text variant="caption" color={theme.colors.textMuted}>
                <Trans>Its paired devices are listed once it is the server in use.</Trans>
              </Text>
            </>
          )}
          <ServerRowEditor server={server} onUnpair={onUnpair} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Edit and unpair, the two things a paired record's own row offers below the
 * device list or the "use this server" pill.
 *
 * `editing` lives here rather than on `ServerRow`, which is what makes it
 * reset for free: this component exists only inside `{open ? ... : null}`, so
 * closing the row unmounts it, and opening it again mounts a fresh one with
 * `editing` back at `false` -- the same trick `UnpairAction`'s `armed` uses,
 * stated once instead of twice.
 */
function ServerRowEditor({ server, onUnpair }: { server: GatewayRecord; onUnpair: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <ServerEditForm server={server} onDone={() => setEditing(false)} />;
  }

  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Edit ${server.label}`}
        onPress={() => setEditing(true)}
        style={[styles.action, { backgroundColor: theme.colors.surfaceRaised }]}>
        <Pencil size={15} color={theme.colors.text} strokeWidth={2} />
        <Text variant="caption" color={theme.colors.text}>
          <Trans>Edit this server</Trans>
        </Text>
      </PressableScale>
      <UnpairAction label={server.label} onUnpair={onUnpair} />
    </>
  );
}

/**
 * The name and address, editable in place.
 *
 * One field per fact the record actually has -- `label` and `url` -- rather
 * than splitting the address into host and port. The app already asks for a
 * gateway address exactly this way, as one field, on the pairing screen's own
 * manual-entry card (`app/explore.tsx`), and this reaches for the very same
 * `normalizeGatewayUrl` that validates it there. A second vocabulary for the
 * same fact would only be a second thing to keep in step with the first.
 *
 * Changing the address is safe -- see the note on `updateGateway` in
 * `gateway-storage.ts`. The pairing keys on `serverId` and the token the
 * gateway issued for it, not on where the app reaches it, so this writes the
 * two facts a record states about itself and nothing about what proves it is
 * the same server. That is worth saying on the form itself: an address field
 * on something already paired is exactly the place a reader stops to wonder
 * whether typing in it starts the pairing over.
 */
function ServerEditForm({ server, onDone }: { server: GatewayRecord; onDone: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const { editRecord } = useGatewayRecord();
  const [label, setLabel] = useState(server.label);
  const [url, setUrl] = useState(server.url);
  const [labelError, setLabelError] = useState<string | undefined>(undefined);
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setLabelError(t`Enter a name.`);
      return;
    }
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeGatewayUrl(url);
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : t`Gateway URL is not valid.`);
      return;
    }
    if (!normalizedUrl) {
      setUrlError(t`Enter a gateway URL.`);
      return;
    }
    setLabelError(undefined);
    setUrlError(undefined);
    setSaving(true);
    try {
      await editRecord(server.serverId, { label: trimmedLabel, url: normalizedUrl });
      await feedback('success');
      onDone();
    } catch (error) {
      setSaving(false);
      showToast({
        variant: 'danger',
        title: t`Could not save changes`,
        message: describeGatewayFailure(
          error,
          t`Its details are stored securely on this device; try again.`
        ).message,
      });
    }
  }

  return (
    <View style={styles.editForm}>
      <Input
        label={t`Server name`}
        value={label}
        onChangeText={(value) => {
          setLabel(value);
          if (labelError) setLabelError(undefined);
        }}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="next"
        error={labelError}
        variant="outline"
        size="compact"
      />
      <Input
        label={t`Gateway URL`}
        value={url}
        onChangeText={(value) => {
          setUrl(value);
          if (urlError) setUrlError(undefined);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://100.x.x.x:23847"
        error={urlError}
        variant="outline"
        size="compact"
      />
      <Text variant="caption" color={theme.colors.textMuted}>
        <Trans>The address is where this paired server is reached. Changing it does not unpair the device.</Trans>
      </Text>
      <View style={styles.editButtons}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Cancel editing ${server.label}`}
          disabled={saving}
          onPress={onDone}
          style={[styles.action, styles.editButton, { backgroundColor: theme.colors.surfaceRaised }]}>
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Cancel</Trans>
          </Text>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Save changes to ${server.label}`}
          feedback="selection"
          disabled={saving}
          onPress={() => void save()}
          style={[styles.action, styles.editButton, { backgroundColor: theme.colors.primary }]}>
          <Text variant="caption" color={theme.colors.onPrimary}>
            {saving ? t`Saving…` : t`Save`}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

/**
 * Two taps, never one. Unpairing drops a gateway token this device cannot get
 * back without the machine in front of it, so the destructive tap arms first
 * rather than firing on the first press.
 */
function UnpairAction({ label, onUnpair }: { label: string; onUnpair: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [armed, setArmed] = useState(false);

  // Collapsing the row and coming back must not leave a primed destructive
  // button waiting.
  useEffect(() => () => setArmed(false), []);

  return armed ? (
    <View style={styles.armedRow}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Confirm unpair ${label}`}
        feedback="selection"
        onPress={onUnpair}
        style={[styles.action, styles.armedButton, { backgroundColor: theme.colors.danger }]}>
        <Trash2 size={15} color={theme.colors.onPrimary} strokeWidth={2.2} />
        <Text variant="caption" color={theme.colors.onPrimary} style={styles.armedText}>
          <Trans>Unpair</Trans>
        </Text>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Keep ${label}`}
        onPress={() => setArmed(false)}
        style={[styles.action, styles.armedButton, { backgroundColor: theme.colors.surfaceRaised }]}>
        <Text variant="caption" color={theme.colors.textMuted}>
          <Trans>Cancel</Trans>
        </Text>
      </PressableScale>
    </View>
  ) : (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Unpair ${label}`}
      onPress={() => setArmed(true)}
      style={[styles.action, { backgroundColor: theme.colors.dangerSubtle }]}>
      <Trash2 size={15} color={theme.colors.danger} strokeWidth={2} />
      <Text variant="caption" color={theme.colors.danger}>
        <Trans>Unpair this server</Trans>
      </Text>
    </PressableScale>
  );
}

/**
 * Every device holding a token for this gateway, and the revoke that cuts one
 * off without disturbing the others.
 *
 * This block used to sit under Security, in English only, describing a server
 * that was named nowhere near it. It is the same code; it now sits inside the
 * row for the server it is talking about, which is also the only server it
 * *can* talk about -- the gateway answers `/api/pairings` for whichever record
 * the app is currently attached to.
 */
function PairedDevices({ server }: { server: GatewayRecord }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDevices(await loadPairedDevices());
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Rough, and deliberately so: the exact second a device last spoke is not a
   * fact anyone acts on, and a precise timestamp invites reading it as one.
   *
   * The whole sentence is one message rather than "Last seen" with a duration
   * glued on, because word order is a language's business and a translator
   * handed two fragments cannot fix one that arrives in the wrong place.
   *
   * Inside the component on purpose: the `useLingui` macro only rewrites `t`
   * templates in the scope that called the hook, so the same function at module
   * level compiles to a bare template literal that never reaches the catalog --
   * which is exactly what `i18n/__tests__/macro-expansion.test.ts` exists to
   * catch.
   */
  function lastSeen(unixMs: number, nowMs: number): string {
    if (!unixMs) return t`Never seen`;
    const seconds = Math.max(0, Math.round((nowMs - unixMs) / 1000));
    if (seconds < 60) return t`Last seen just now`;
    const minutes = Math.floor(seconds / 60);
    if (seconds < 3600) return t`Last seen ${minutes}m ago`;
    const hours = Math.floor(seconds / 3600);
    if (seconds < 86400) return t`Last seen ${hours}h ago`;
    const days = Math.floor(seconds / 86400);
    return t`Last seen ${days}d ago`;
  }

  async function revoke(device: PairedDevice) {
    setConfirming(null);
    setRevoking(device.id);
    try {
      await revokePairedDevice(device.id);
      await feedback('success');
      await refresh();
    } catch (error) {
      showToast({
        variant: 'danger',
        title: t`Could not revoke device`,
        message: describeGatewayFailure(error, t`Try again once the gateway responds.`).message,
      });
    } finally {
      setRevoking(null);
    }
  }

  if (devices === null) {
    return (
      <Text variant="caption" color={theme.colors.textMuted}>
        <Trans>Loading paired devices…</Trans>
      </Text>
    );
  }

  if (devices.length === 0) {
    return (
      <Text variant="caption" color={theme.colors.textMuted}>
        <Trans>This gateway has not listed any paired devices.</Trans>
      </Text>
    );
  }

  // Read at render because "last seen" is relative to *now*, not to whenever
  // the list last changed: an open row has to keep telling the truth about a
  // timestamp ageing under it. The alternative is a ticking clock in state,
  // which re-renders the list to change one caption. Same call and same reason
  // as the home card's freshness read.
  // oxlint-disable-next-line react/purity -- deliberate: see above.
  const nowMs = Date.now();

  return (
    <View style={styles.devices}>
      <Text variant="caption" color={theme.colors.textMuted}>
        <Trans>Each device holds its own token for {server.label}.</Trans>
      </Text>
      {devices.map((device) => (
        <View key={device.id} style={styles.deviceRow}>
          <View style={styles.flexOne}>
            <Text variant="caption" numberOfLines={1}>
              {device.current ? t`${device.name} (this device)` : device.name}
            </Text>
            <Text variant="caption" color={theme.colors.textSubtle}>
              {lastSeen(device.last_seen_unix_ms, nowMs)}
            </Text>
          </View>
          {/* The gateway marks the requesting device, and it is the one device
              that must not be revoked from here: doing so would cut this phone
              off mid-request. */}
          {device.current ? null : confirming === device.id ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Confirm revoke ${device.name}`}
              feedback="selection"
              disabled={revoking !== null}
              onPress={() => void revoke(device)}
              style={[styles.revoke, { backgroundColor: theme.colors.danger }]}>
              <Text variant="caption" color={theme.colors.onPrimary} style={styles.armedText}>
                <Trans>Revoke</Trans>
              </Text>
            </PressableScale>
          ) : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Revoke ${device.name}`}
              disabled={revoking !== null}
              onPress={() => setConfirming(device.id)}
              style={styles.revoke}>
              <Text variant="caption" color={theme.colors.danger}>
                {revoking === device.id ? t`Revoking…` : t`Revoke`}
              </Text>
            </PressableScale>
          )}
        </View>
      ))}
    </View>
  );
}

// Every number here is `LADDER`, so a server row's text starts on the same x as
// a switch row's four sections down. It used to be inset 14 against everything
// else's 12, which is invisible on its own and unmissable in a column.
const styles = StyleSheet.create({
  note: { padding: LADDER.gutter, gap: LADDER.tight },
  row: { paddingHorizontal: LADDER.gutter },
  rowHeader: {
    minHeight: 60,
    paddingVertical: LADDER.snug,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.snug,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  name: { flexShrink: 1 },
  usingChip: {
    paddingHorizontal: LADDER.gap,
    paddingVertical: 2,
    borderRadius: LADDER.gap,
    borderCurve: 'continuous',
  },
  usingText: { letterSpacing: 0.9, fontWeight: '700' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap, paddingTop: 2 },
  statusText: { letterSpacing: 0.9 },
  // Under the status line rather than beside it: the dot already owns that
  // row, and a second fact crowded onto the same line reads as a correction
  // to the first rather than as history alongside it.
  historyText: { paddingTop: 2 },
  actions: { paddingBottom: LADDER.gutter, gap: LADDER.gap },
  editForm: { gap: LADDER.snug },
  editButtons: { flexDirection: 'row', gap: LADDER.gap },
  editButton: { flex: 1 },
  action: {
    minHeight: 40,
    paddingHorizontal: LADDER.snug,
    borderRadius: 12,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: LADDER.gap,
  },
  armedRow: { flexDirection: 'row', gap: LADDER.gap },
  armedButton: { flex: 1 },
  armedText: { fontWeight: '700' },
  devices: { gap: LADDER.gap },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: LADDER.snug },
  revoke: {
    minHeight: 32,
    paddingHorizontal: LADDER.snug,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: { flex: 1, minWidth: 0, gap: 2 },
});
