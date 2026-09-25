import { RuleTester } from 'oxlint/plugins-dev';
import plugin from './index.ts';
RuleTester.describe = (_name, run) => run();
RuleTester.it = (_name, run) => run();
new RuleTester().run('no-reanimated-dependencies', plugin.rules['no-reanimated-dependencies']!, {
  valid: [
    "import { useAnimatedStyle } from 'react-native-reanimated'; useAnimatedStyle(() => ({ opacity: 1 }));",
    "import { useFrameCallback } from 'react-native-reanimated'; useFrameCallback(() => {}, false);",
    "import { useAnimatedReaction } from 'react-native-reanimated'; useAnimatedReaction(() => 1, () => {});",
    'function useAnimatedStyle(a, b) {} useAnimatedStyle(() => {}, []);',
  ],
  invalid: [
    {
      code: "import { useAnimatedStyle as style } from 'react-native-reanimated'; style(() => ({}), []);",
      errors: 1,
    },
    {
      code: "import * as R from 'react-native-reanimated'; R.useAnimatedReaction(() => 1, () => {}, []);",
      errors: 1,
    },
    {
      code: "import { useDerivedValue } from 'react-native-reanimated'; const deps = []; useDerivedValue(() => 1, deps);",
      errors: 1,
    },
  ],
});
