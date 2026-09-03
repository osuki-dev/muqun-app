import { i18n } from '@lingui/core';
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  AGENT_WIDGET_NAMES,
  readAgentWidgetSnapshot,
  type AgentWidgetName,
  type AgentWidgetSnapshot,
} from '@/lib/agent-widget';
import { renderAgentWidget } from '@/lib/agent-widget-layout';

/**
 * Everything that touches the widget native module lives here, so the rest of
 * the app can reach it through one lazy `require` and stay loadable on a binary
 * that predates the module.
 *
 * There are two ways a tile gets repainted:
 *
 * - the app pushes, whenever it has just confirmed agent status with the
 *   gateway (`pushAgentWidgets`); and
 * - Android wakes the headless task on its own schedule, or because the user
 *   added or resized the tile (`agentWidgetTaskHandler`).
 *
 * The push path is the one that carries new data. The system path only re-reads
 * what the app already stored, which is exactly why the widget never needs the
 * gateway token: with no app run there is no new status to show, and the tile
 * says how old its data is instead of pretending otherwise.
 */

/**
 * Reaches the i18n runtime without putting it in this module's own graph.
 *
 * Deliberately a `require`, and for the reason the two beside it are: this file
 * is required from `index.ts` at the JS bundle's entry, in the app as well as in
 * the headless task, because that is where `registerWidgetTaskHandler` has to be
 * called. A static import of `@/i18n/headless` here would therefore drag the
 * `@formatjs` polyfills and all eight catalogs ahead of the app's first frame on
 * every Android cold start, for a home-screen tile that is off by default.
 *
 * `require` rather than `await import()` because these are the only two such
 * call sites in the app, and the one thing an OTA-shipped headless task must not
 * risk is a Metro chunking decision -- a `require` is a lookup in a bundle that
 * already contains the module, on every configuration, forever. The `typeof
 * import` is a type position only and is erased.
 */
function headlessI18n(): typeof import('@/i18n/headless') {
  // oxlint-disable-next-line typescript/no-require-imports
  return require('@/i18n/headless') as typeof import('@/i18n/headless');
}

/**
 * Gives the tile a language before anything asks it for a word.
 *
 * The `i18n.locale` check is what makes the app's own push path free: the
 * provider activates a locale as it is imported, so in the foreground this is
 * one property read and the catalogs are never touched from here at all.
 */
async function ensureWidgetLocale(): Promise<void> {
  if (i18n.locale) return;
  await headlessI18n().activateWidgetLocale();
}

/** Repaints every instance of both widgets with `snapshot`. */
export async function pushAgentWidgets(snapshot: AgentWidgetSnapshot | null): Promise<void> {
  await ensureWidgetLocale();
  await Promise.all(
    AGENT_WIDGET_NAMES.map((name) =>
      requestWidgetUpdate({
        widgetName: name,
        renderWidget: () => renderAgentWidget(name, snapshot),
      })
    )
  );
}

/**
 * Handles the events Android raises against the widget itself.
 *
 * Taps are not handled here: rows use `OPEN_URI`, which the library turns into
 * an intent without waking JS at all, so a tap opens the panel even when the
 * app has been killed.
 */
export async function agentWidgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const name = asAgentWidgetName(props.widgetInfo.widgetName);
  if (!name) return;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      // Resolved on every draw rather than once per JS context, and not behind
      // the `i18n.locale` guard `ensureWidgetLocale` uses. A headless context
      // can outlive the wake that created it, and the device language can
      // change under it with no app run to notice; re-resolving costs a settings
      // read the store has already cached and a synchronous `getLocales()`, and
      // `activateWidgetLocale` only re-activates when the answer actually moved.
      await headlessI18n().activateWidgetLocale();
      const snapshot = await readAgentWidgetSnapshot();
      props.renderWidget(renderAgentWidget(name, snapshot));
      return;
    }
    case 'WIDGET_DELETED':
    case 'WIDGET_CLICK':
      return;
    default:
      return;
  }
}

function asAgentWidgetName(value: string): AgentWidgetName | null {
  return AGENT_WIDGET_NAMES.find((name) => name === value) ?? null;
}
