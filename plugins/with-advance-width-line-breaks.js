// Line breaking by advance width, the way every text measurer in this app
// already assumes.
//
// From API 35, a `TextView` in an app that targets 35+ breaks lines by the
// glyphs' drawn bounds (`useBoundsForWidth` defaults to true), while a bare
// `StaticLayout.Builder` still defaults to advance widths. React Native's own
// text reconciles the two by reflection. react-native-enriched-markdown does
// not: it measures with a `StaticLayout` and draws with a `TextView`, so the
// shadow node and the view disagree by exactly the overhang of the last glyph.
//
// With an upright face the overhang is zero and nothing shows. With an italic
// one -- any reader-installed italic font -- a plate that hugs a short reply is
// measured one line wide, and the view then finds the same width a fraction of
// a pixel too narrow and wraps: "Hi. How can I / help?" inside a plate sized
// for the whole sentence, with the second line hanging out of it.
//
// A view attribute resolves from the theme when neither the layout nor a style
// names it, so one item on `AppTheme` restores the pre-35 rule for every
// `TextView` the app creates, which is what the measurers were written
// against. No third-party module is patched. Older platforms ignore the item.
// react-doctor-disable-next-line eslint/no-undef -- Expo config plugins are loaded as CommonJS.
// react-doctor-disable-next-line typescript/no-require-imports -- Expo config plugins are loaded as CommonJS.
const { withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

const ITEM = 'android:useBoundsForWidth';

// react-doctor-disable-next-line eslint/no-undef -- Expo config plugins are loaded as CommonJS.
module.exports = function withAdvanceWidthLineBreaks(config) {
  return withAndroidStyles(config, (mod) => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: ITEM,
      value: 'false',
      targetApi: '35',
    });
    return mod;
  });
};
