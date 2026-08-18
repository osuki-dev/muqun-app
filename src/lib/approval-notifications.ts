// The global instance, not a hook: this runs at registration time, not in a
// render, so there is nothing for React Compiler to over-memoize. The buttons
// are re-registered on every push registration -- app start and each return to
// the foreground -- which is what keeps them in the current locale.
import { i18n } from '@lingui/core';
import * as Notifications from 'expo-notifications';

import { approvalActionTitle } from '@/i18n/labels';
import {
  answerPaneApproval,
  ApprovalConflictError,
  type GatewayEndpoint,
} from '@/lib/gateway-client';
import {
  APPROVAL_ACTION_PREFIX,
  APPROVAL_NOTIFICATION_ACTIONS,
  APPROVAL_PUSH_CATEGORY_ID,
  approvalPushTarget,
  pushOffersDecision,
  type ApprovalPushTarget,
  type NamedApprovalDecision,
} from '@/lib/pane-approval';

/**
 * Answering a permission menu from the notification itself.
 *
 * The gateway tags an approval push with `categoryId: "approval"` and carries
 * the option *decisions* -- never the agent's own wording, which routinely
 * quotes a command or a path. So the buttons here are named by the app, from
 * the decisions, and the category is registered once at startup rather than per
 * notification: both platforms resolve a notification's actions from a category
 * that was registered before it arrived, so there is no chance to tailor the
 * buttons to one particular menu.
 *
 * A menu that does not offer one of the three is not a problem: the gateway
 * answers `409 decision_unavailable`, and the fallback for every failure is the
 * same -- open the pane and let the banner ask properly.
 */
/**
 * What acting on the notification did, so the caller can decide whether to open
 * the app. `open-pane` is the answer for everything that did not land.
 */
export type ApprovalActionOutcome = 'answered' | 'open-pane';

export { approvalActionDecision } from '@/lib/pane-approval';

/**
 * Register the approve/deny buttons.
 *
 * `opensAppToForeground: false` is what makes this worth doing: a user unblocks
 * an agent from the lock screen without the app ever coming up. The cost is
 * that on Android a *terminated* app receives no action at all -- delivering
 * one needs `expo-task-manager` and a headless background task, which is a
 * native dependency this build does not carry. A backgrounded-but-running app,
 * which is the common case while watching an agent, is delivered normally.
 */
export async function registerApprovalNotificationCategory(): Promise<void> {
  if (process.env.EXPO_OS === 'web') return;
  await Notifications.setNotificationCategoryAsync(
    APPROVAL_PUSH_CATEGORY_ID,
    APPROVAL_NOTIFICATION_ACTIONS.map((action) => ({
      identifier: `${APPROVAL_ACTION_PREFIX}${action.decision}`,
      buttonTitle: i18n._(approvalActionTitle[action.decision]),
      options: {
        opensAppToForeground: false,
        isDestructive: action.destructive,
        isAuthenticationRequired: false,
      },
    }))
  );
}

/**
 * Answer the menu a notification is about.
 *
 * The fingerprint travels with the push, so an answer tapped on a notification
 * from ten minutes ago is rejected by the gateway instead of being applied to
 * whatever the agent is asking now. That rejection, like every other failure,
 * resolves to `open-pane`.
 */
export async function answerApprovalFromNotification(
  data: unknown,
  decision: NamedApprovalDecision,
  resolveEndpoint: (serverId: string) => GatewayEndpoint | null
): Promise<{ outcome: ApprovalActionOutcome; target: ApprovalPushTarget | null }> {
  const target = approvalPushTarget(data);
  if (!target) return { outcome: 'open-pane', target: null };

  const endpoint = resolveEndpoint(target.serverId);
  if (!endpoint) return { outcome: 'open-pane', target };

  // A decision this menu never offered is known to be unanswerable before the
  // request is made; the round trip's only possible answer is a 409.
  if (!pushOffersDecision(target, decision)) return { outcome: 'open-pane', target };

  try {
    const result = await answerPaneApproval(
      target.sessionId,
      target.paneId,
      { decision, fingerprint: target.fingerprint },
      endpoint
    );
    // The gateway confirms with Enter only when the menu is still standing, so
    // `resolved: false` means the answer went in but the agent is asking
    // something else now -- worth opening the pane for.
    return { outcome: result.resolved ? 'answered' : 'open-pane', target };
  } catch (error) {
    if (__DEV__ && !(error instanceof ApprovalConflictError)) {
      console.warn('Answering an approval from a notification failed.', error);
    }
    return { outcome: 'open-pane', target };
  }
}
