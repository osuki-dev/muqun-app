// These are not React components in the usual sense. Nothing mounts them: the
// widget library walks the element tree and calls each function directly to
// flatten it into RemoteViews, so the memoisation the React Compiler injects
// (this app builds with `reactCompiler`) shows up as an invalid hook call the
// first time a tile is drawn. The compiler has to be off for this file.
'use no memo';

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { FlexWidget, TextWidget, type WidgetRepresentation } from 'react-native-android-widget';

import { agentStatusWord } from '@/i18n/labels';
import {
  agentWidgetAgeParts,
  agentWidgetUri,
  isAgentWidgetStale,
  AGENT_WIDGET_ROW,
  type AgentWidgetEntry,
  type AgentWidgetName,
  type AgentWidgetSnapshot,
} from '@/lib/agent-widget';
import { statusColor } from '@/lib/herdr-entity';

/**
 * The two home-screen tiles.
 *
 * These render to RemoteViews, not to a React Native view tree: there is no
 * layout pass to measure against and no way to react to a tap beyond handing
 * the launcher an intent. So both layouts are fixed-height stacks sized for the
 * smallest cell the launcher will give them, and every interactive area is a
 * deep link the app already knows how to route.
 *
 * Unlike the iOS Live Activity, this code runs in the app's own JS bundle, so
 * the status colours come straight from `statusColor` rather than being copied
 * into a separate widget runtime.
 *
 * **Why the strings are `i18n._(msg`...`)` and not a hook.** Nothing here is
 * mounted -- the widget library walks the tree and calls each function itself --
 * so there is no provider above these components and `useLingui` has nothing to
 * subscribe to. The global instance plus an inert `msg` descriptor is the same
 * shape the notification channels use for the same reason (`src/lib/
 * notifications.ts`), and it resolves at the moment the tree is built, which is
 * after `activateWidgetLocale` has run in the task handler. The descriptors are
 * built at the call site rather than hoisted to module scope because several of
 * them interpolate, and a hoisted descriptor would freeze the first values it
 * saw.
 */

type Palette = {
  background: `#${string}`;
  surface: `#${string}`;
  text: `#${string}`;
  muted: `#${string}`;
  accent: `#${string}`;
};

// Matched to the app's own two backgrounds (`app.json` splash, Live Activity
// chrome) so a tile does not look like a different product next to the icon.
const DARK: Palette = {
  background: '#050B12',
  surface: '#101922',
  text: '#FCFBFA',
  muted: '#A6AFBE',
  accent: '#FF5A4A',
};

const LIGHT: Palette = {
  background: '#FCFBFA',
  surface: '#F1EFEC',
  text: '#0B1017',
  muted: '#5A6675',
  accent: '#FF5A4A',
};

/** A 2x2 cell fits three rows and a header before it starts clipping. */
const SQUARE_ROWS = 3;
/** A 4x1 cell is one line high, so agents go side by side instead. */
const ROW_CHIPS = 3;

/**
 * Builds both themes for a widget. The launcher picks between them, so the
 * tile follows the system theme even though nothing is mounted to observe it.
 */
export function renderAgentWidget(
  name: AgentWidgetName,
  snapshot: AgentWidgetSnapshot | null
): WidgetRepresentation {
  const nowMs = Date.now();
  return {
    light: <AgentWidget name={name} palette={LIGHT} snapshot={snapshot} nowMs={nowMs} />,
    dark: <AgentWidget name={name} palette={DARK} snapshot={snapshot} nowMs={nowMs} />,
  };
}

type WidgetProps = {
  name: AgentWidgetName;
  palette: Palette;
  snapshot: AgentWidgetSnapshot | null;
  nowMs: number;
};

function AgentWidget({ name, palette, snapshot, nowMs }: WidgetProps) {
  if (name === AGENT_WIDGET_ROW) {
    return <AgentRowWidget palette={palette} snapshot={snapshot} nowMs={nowMs} />;
  }
  return <AgentSquareWidget palette={palette} snapshot={snapshot} nowMs={nowMs} />;
}

function AgentSquareWidget({ palette, snapshot, nowMs }: Omit<WidgetProps, 'name'>) {
  const shown = snapshot?.agents.slice(0, SQUARE_ROWS) ?? [];
  const overflow = (snapshot?.agents.length ?? 0) - shown.length;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={i18n._(msg`Muqun agent status`)}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: palette.background,
        borderRadius: 20,
        padding: 12,
      }}>
      <Header palette={palette} snapshot={snapshot} nowMs={nowMs} />
      {snapshot && shown.length > 0 ? (
        <FlexWidget
          style={{ width: 'match_parent', flexDirection: 'column', flexGap: 6, marginTop: 8 }}>
          {shown.map((agent) => (
            <AgentRow key={agent.id} agent={agent} palette={palette} snapshot={snapshot} />
          ))}
          {overflow > 0 ? (
            <TextWidget
              text={i18n._(msg`+${overflow} more`)}
              style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}
            />
          ) : null}
        </FlexWidget>
      ) : (
        <EmptyState palette={palette} connected={Boolean(snapshot)} />
      )}
    </FlexWidget>
  );
}

function AgentRowWidget({ palette, snapshot, nowMs }: Omit<WidgetProps, 'name'>) {
  const shown = snapshot?.agents.slice(0, ROW_CHIPS) ?? [];
  const overflow = (snapshot?.agents.length ?? 0) - shown.length;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={i18n._(msg`Muqun agent status`)}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: palette.background,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexGap: 12,
      }}>
      <FlexWidget style={{ flexDirection: 'column' }}>
        <TextWidget
          text="Muqun"
          style={{ fontSize: 13, fontWeight: '600', color: palette.accent }}
        />
        <TextWidget
          text={freshness(snapshot, nowMs)}
          style={{ fontSize: 10, color: palette.muted }}
        />
      </FlexWidget>
      {snapshot && shown.length > 0 ? (
        <FlexWidget style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexGap: 8 }}>
          {shown.map((agent) => (
            <AgentChip key={agent.id} agent={agent} palette={palette} snapshot={snapshot} />
          ))}
          {overflow > 0 ? (
            <TextWidget text={`+${overflow}`} style={{ fontSize: 11, color: palette.muted }} />
          ) : null}
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={emptyLine(Boolean(snapshot))}
            style={{ fontSize: 12, color: palette.muted }}
            maxLines={1}
            truncate="END"
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function Header({
  palette,
  snapshot,
  nowMs,
}: {
  palette: Palette;
  snapshot: AgentWidgetSnapshot | null;
  nowMs: number;
}) {
  return (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
      {/* `flex` is a container property in this renderer, so anything that has
          to take the remaining width is wrapped rather than styled directly. */}
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={snapshot?.serverLabel || 'Muqun'}
          style={{ fontSize: 12, fontWeight: '600', color: palette.text }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>
      <TextWidget
        text={freshness(snapshot, nowMs)}
        style={{ fontSize: 10, color: palette.muted }}
      />
    </FlexWidget>
  );
}

function AgentRow({
  agent,
  palette,
  snapshot,
}: {
  agent: AgentWidgetEntry;
  palette: Palette;
  snapshot: AgentWidgetSnapshot;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: agentWidgetUri(snapshot, agent) }}
      accessibilityLabel={agentLabel(agent)}
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        flexGap: 8,
        backgroundColor: palette.surface,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 6,
      }}>
      <StatusDot status={agent.status} />
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={agent.name}
          style={{ fontSize: 12, color: palette.text }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>
    </FlexWidget>
  );
}

function AgentChip({
  agent,
  palette,
  snapshot,
}: {
  agent: AgentWidgetEntry;
  palette: Palette;
  snapshot: AgentWidgetSnapshot;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: agentWidgetUri(snapshot, agent) }}
      accessibilityLabel={agentLabel(agent)}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        flexGap: 6,
        backgroundColor: palette.surface,
        borderRadius: 11,
        paddingHorizontal: 8,
        paddingVertical: 5,
      }}>
      <StatusDot status={agent.status} />
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget
          text={agent.name}
          style={{ fontSize: 11, color: palette.text }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>
    </FlexWidget>
  );
}

/**
 * RemoteViews has no circle primitive worth the trouble, so the dot is an empty
 * box with a radius equal to half its side.
 */
function StatusDot({ status }: { status: AgentWidgetEntry['status'] }) {
  return (
    <FlexWidget
      style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: statusColor(status) }}
    />
  );
}

function EmptyState({ palette, connected }: { palette: Palette; connected: boolean }) {
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', justifyContent: 'center' }}>
      <TextWidget
        text={emptyLine(connected)}
        style={{ fontSize: 12, color: palette.muted }}
        maxLines={2}
      />
    </FlexWidget>
  );
}

/**
 * What a tile with nothing to list says instead.
 *
 * Two different facts, not one sentence with a word swapped: "we have your
 * server and it has no agents" and "we have no server yet" are different things
 * to tell someone, and only one of them is asking for a tap.
 */
function emptyLine(connected: boolean): string {
  return connected ? i18n._(msg`No agents running`) : i18n._(msg`Open Muqun to connect`);
}

/**
 * A name and a status word, both in the active locale, joined the way a
 * screen reader reads a list -- the same shape the server cards use for the
 * same row, and deliberately not a sentence. The status word itself is the
 * app's own `agentStatusWord`, so the tile and the card cannot end up calling
 * the same state different things.
 */
function agentLabel(agent: AgentWidgetEntry): string {
  const status = i18n._(agentStatusWord[agent.status] ?? agentStatusWord.unknown);
  return `${agent.name}, ${status}`;
}

/**
 * The widget is only ever as fresh as the last time the app was open, so it
 * says so rather than implying it is watching the gateway itself.
 */
function freshness(snapshot: AgentWidgetSnapshot | null, nowMs: number): string {
  if (!snapshot) return i18n._(msg`not connected`);
  const age = ageLine(snapshot, nowMs);
  return isAgentWidgetStale(snapshot, nowMs) ? i18n._(msg`stale · ${age}`) : age;
}

/**
 * One message per unit rather than a template with a unit letter dropped into a
 * hole: "5m ago" is English's own abbreviation, and a translator needs the whole
 * phrase to write theirs. `agent-widget` decides which bucket the age falls in;
 * this says it.
 *
 * `parts.value` rather than a destructured `value`, matching `useRelativeTime`
 * to the character. The macro names a placeholder after a plain identifier and
 * numbers anything else, so this is what puts the widget on the very same
 * `{0}m ago` the rest of the app already says -- one catalog entry, translated
 * once, and no way for the tile and a card to disagree about how an age reads.
 */
function ageLine(snapshot: AgentWidgetSnapshot, nowMs: number): string {
  const parts = agentWidgetAgeParts(snapshot, nowMs);
  if (parts.unit === 'now') return i18n._(msg`just now`);
  if (parts.unit === 'minute') return i18n._(msg`${parts.value}m ago`);
  if (parts.unit === 'hour') return i18n._(msg`${parts.value}h ago`);
  return i18n._(msg`${parts.value}d ago`);
}
