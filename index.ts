// Custom entry point.
//
// `expo-router/entry` is still what boots the app -- importing it registers the
// root component exactly as the default entry did. The only thing added here is
// the Android widget's headless task, which has to be registered on the JS
// bundle's entry rather than inside a screen: Android starts that task with no
// activity running, so nothing in `src/app` has mounted by the time it fires.
import 'expo-router/entry';

import { Platform } from 'react-native';

import type { agentWidgetTaskHandler } from './src/lib/agent-widget-bridge';

if (Platform.OS === 'android') {
  try {
    // Deliberately `require`, and deliberately inside a guard: the widget
    // package resolves its native module at import time and throws when the
    // binary predates it. At the entry point that would be a launch crash, and
    // an over-the-air update reaches every install built before this landed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const widget = require('react-native-android-widget') as {
      registerWidgetTaskHandler: (handler: typeof agentWidgetTaskHandler) => void;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bridge = require('./src/lib/agent-widget-bridge') as {
      agentWidgetTaskHandler: typeof agentWidgetTaskHandler;
    };
    widget.registerWidgetTaskHandler(bridge.agentWidgetTaskHandler);
  } catch {
    // No widget module in this binary. The app runs; the home screen tile does
    // not update until the next native build.
  }
}
