// react-native-android-widget pulls androidx.work:work-runtime:2.8.1, while an
// older transitive work-runtime-ktx:2.7.1 still bundles the Kt extension classes
// that 2.8 merged into work-runtime — checkReleaseDuplicateClasses fails on the
// pair. Forcing ktx onto the same 2.8.1 (an empty shell artifact there) dedupes.
const { withAppBuildGradle } = require('expo/config-plugins');

const SNIPPET = `
configurations.all {
    resolutionStrategy {
        force 'androidx.work:work-runtime:2.8.1'
        force 'androidx.work:work-runtime-ktx:2.8.1'
    }
}
`;

module.exports = function withAndroidxWorkAlignment(config) {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes("force 'androidx.work:work-runtime-ktx")) {
      mod.modResults.contents += SNIPPET;
    }
    return mod;
  });
};
