import { StyleSheet, type StyleProp } from 'react-native';

/**
 * `StyleSheet.flatten` for a `StyleProp<ViewStyle>`.
 *
 * React Native 0.88 types `flatten`'s parameter as the animated style prop
 * (`____DangerouslyImpreciseAnimatedStyleProp_Internal`), whose `userSelect`
 * is the literal union. Expo's web typings (`expo/types/react-native-web.d.ts`)
 * augment `ViewStyle` with `userSelect?: string` for the web build, so a plain
 * `StyleProp<ViewStyle>` no longer satisfies that parameter and every
 * `StyleSheet.flatten(style)` on a view style is a type error. The runtime
 * function is unchanged; only the parameter type disagrees with Expo's
 * augmentation, so this helper narrows the one call. Remove it when either
 * side relaxes the type.
 */
export function flattenStyle<T extends object>(style: StyleProp<T> | undefined): T | undefined {
  return (StyleSheet.flatten(style as never) ?? undefined) as T | undefined;
}
