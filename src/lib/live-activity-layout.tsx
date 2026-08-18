import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityLayout } from 'expo-widgets';

/**
 * The status vocabulary the gateway reports for an agent. Kept as a widening
 * union rather than reusing the loose `string` from `HerdrEntity` because these
 * props cross a serialization boundary into the widget extension, where an
 * unexpected value has no UI to fall back to.
 */
export type AgentActivityStatus = 'working' | 'idle' | 'blocked' | 'done' | 'unknown';

/**
 * Everything the Live Activity draws. Must stay JSON-serializable: the props
 * are stringified into ActivityKit's `ContentState` and read back inside the
 * widget extension, so `Date` and functions do not survive the trip.
 */
export type AgentActivityProps = {
  agentName: string;
  status: AgentActivityStatus;
  /** Second line under the name, usually the pane the agent is attached to. */
  detail: string;
  /** When the current run started, as epoch milliseconds. */
  startedAtMs: number;
};

/** Must match the name the widget extension looks up its stored layout by. */
export const AGENT_ACTIVITY_NAME = 'AgentStatusActivity';

/**
 * The `'widget'` directive makes Babel replace this function with its own
 * source text, which is then evaluated inside the widget extension's JS
 * runtime. Nothing from module scope exists there -- only the SwiftUI
 * components and modifiers the runtime installs as globals -- so every colour
 * and label has to be written out inside the body rather than hoisted into a
 * shared constant.
 */
function AgentStatusActivity(props: AgentActivityProps): LiveActivityLayout {
  'widget';

  // The same status colours the pane list uses, so an agent reads the same on
  // the Lock Screen as it does in the app. Idle is grey with unknown and not
  // green with done -- see `statusColor` in `herdr-entity.ts`, which this has
  // to be kept in step with by hand.
  const accent =
    props.status === 'working'
      ? '#58AFFF'
      : props.status === 'blocked'
        ? '#FFB454'
        : props.status === 'done'
          ? '#4DDB91'
          : '#718095';
  const statusLabel =
    props.status === 'working'
      ? 'Working'
      : props.status === 'blocked'
        ? 'Blocked'
        : props.status === 'idle'
          ? 'Idle'
          : props.status === 'done'
            ? 'Done'
            : 'Unknown';
  // SwiftUI keeps a `dateStyle: 'timer'` label ticking on its own, so the
  // elapsed time stays honest without the app waking up to push an update.
  const startedAt = new Date(props.startedAtMs);

  const elapsed = (size: number) => (
    <Text
      date={startedAt}
      dateStyle="timer"
      modifiers={[
        font({ size, weight: 'semibold', design: 'rounded' }),
        monospacedDigit(),
        foregroundStyle(accent),
      ]}
    />
  );

  return {
    banner: (
      <HStack
        spacing={12}
        modifiers={[padding({ horizontal: 16, vertical: 12 }), activityBackgroundTint('#050B12')]}
      >
        <Image systemName="terminal.fill" size={22} color="#FF5A4A" />
        <VStack alignment="leading" spacing={2}>
          <Text
            modifiers={[
              font({ size: 15, weight: 'semibold' }),
              foregroundStyle('#FCFBFA'),
              lineLimit(1),
            ]}
          >
            {props.agentName}
          </Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle('#A6AFBE'), lineLimit(1)]}>
            {props.detail}
          </Text>
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          {elapsed(17)}
          <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(accent)]}>
            {statusLabel}
          </Text>
        </VStack>
      </HStack>
    ),
    compactLeading: <Image systemName="terminal.fill" size={14} color="#FF5A4A" />,
    compactTrailing: elapsed(13),
    minimal: <Image systemName="circle.fill" size={8} color={accent} />,
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 4 })]}>
        <Text
          modifiers={[
            font({ size: 14, weight: 'semibold' }),
            foregroundStyle('#FCFBFA'),
            lineLimit(1),
          ]}
        >
          {props.agentName}
        </Text>
        <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(accent)]}>
          {statusLabel}
        </Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" modifiers={[padding({ trailing: 4 })]}>
        {elapsed(16)}
      </VStack>
    ),
    expandedBottom: (
      <Text modifiers={[font({ size: 12 }), foregroundStyle('#A6AFBE'), lineLimit(1)]}>
        {props.detail}
      </Text>
    ),
  };
}

export default createLiveActivity<AgentActivityProps>(AGENT_ACTIVITY_NAME, AgentStatusActivity);
