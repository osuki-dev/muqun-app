import { NitroModules } from 'react-native-nitro-modules';

/** OTA bundles may reach an older binary that has no native recorder. */
export function voiceRecorderAvailable() {
  return NitroModules.hasHybridObject('Sound');
}
