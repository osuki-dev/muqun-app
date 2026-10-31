// react-native-android-widget 0.26 uses WorkManager 2.12.0. Older transitive
// work-runtime-ktx artifacts bundle extension classes now in work-runtime, so
// keep both artifacts aligned to the widget dependency to avoid duplicate classes.
// Remove this alignment when the dependency graph no longer brings older ktx.
const { withAppBuildGradle } = require('expo/config-plugins');

const SNIPPET = `
configurations.all {
    resolutionStrategy {
        force 'androidx.work:work-runtime:2.12.0'
        force 'androidx.work:work-runtime-ktx:2.12.0'
    }
}
`;

module.exports = function withAndroidxWorkAlignment(config) {
  return withAppBuildGradle(config, (mod) => {
    // Refresh the previous generated alignment in an existing native project.
    mod.modResults.contents = mod.modResults.contents.replace(
      /androidx\.work:work-runtime(-ktx)?:2\.8\.1/g,
      'androidx.work:work-runtime$1:2.12.0'
    );
    if (!mod.modResults.contents.includes("force 'androidx.work:work-runtime-ktx")) {
      mod.modResults.contents += SNIPPET;
    }
    return mod;
  });
};
