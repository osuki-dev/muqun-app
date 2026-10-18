const { withAndroidManifest, withExpoPlist } = require('expo/config-plugins');

// Expo's built-in update mod still emits metadata when its update package is
// absent. App plugins run after these defaults; remove only the unused loader's
// keys while retaining Hot Updater's configuration and all unrelated metadata.
module.exports = function withHotUpdaterCleanup(config) {
  config = withAndroidManifest(config, (mod) => {
    for (const application of mod.modResults.manifest.application ?? []) {
      if (application['meta-data']) {
        application['meta-data'] = application['meta-data'].filter(
          (item) => !item.$['android:name'].startsWith('expo.modules.updates.')
        );
      }
    }
    return mod;
  });
  return withExpoPlist(config, (mod) => {
    for (const key of Object.keys(mod.modResults)) {
      if (key.startsWith('EXUpdates')) delete mod.modResults[key];
    }
    return mod;
  });
};
