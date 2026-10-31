const { AndroidConfig, withBaseMod } = require('expo/config-plugins');

// expo-alternate-app-icons 11 keeps MainActivity enabled and copies its VIEW
// filters to every icon alias. Keep links and shared files on MainActivity so
// Android does not offer two Muqun entries for the same intent.
module.exports = function withAndroidIconIntents(config) {
  return withBaseMod(config, {
    platform: 'android',
    mod: 'manifest',
    async action({ modRequest: { nextMod, ...modRequest }, ...mod }) {
      // Mods normally run in reverse registration order. Await the existing
      // chain so the icon plugin has generated its aliases before filtering.
      const result = await nextMod({ ...mod, modRequest });
      const application = AndroidConfig.Manifest.getMainApplicationOrThrow(result.modResults);
      const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(result.modResults);
      for (const alias of application['activity-alias'] ?? []) {
        if (alias.$?.['android:targetActivity'] !== mainActivity.$['android:name']) continue;
        alias['intent-filter'] = (alias['intent-filter'] ?? []).filter(
          (filter) =>
            filter.action?.some(
              (action) => action.$['android:name'] === 'android.intent.action.MAIN'
            ) &&
            filter.category?.some(
              (category) => category.$['android:name'] === 'android.intent.category.LAUNCHER'
            )
        );
      }
      return result;
    },
  });
};
