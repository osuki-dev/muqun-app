/** Only fixed labels leave the private EAS log, never arbitrary lines or job payloads. */
export function summarizeBuildFailure(log: string) {
  const phases = [
    'READ_PACKAGE_JSON',
    'INSTALL_DEPENDENCIES',
    'READ_APP_CONFIG',
    'PREBUILD',
    'PREPARE_CREDENTIALS',
    'CONFIGURE_EXPO_UPDATES',
    'RUN_GRADLEW',
    'UPLOAD_APPLICATION_ARCHIVE',
  ];
  let phase = 'INITIALIZATION';
  let position = -1;
  for (const candidate of phases) {
    const index = log.lastIndexOf(`[${candidate}]`);
    if (index > position) {
      position = index;
      phase = candidate;
    }
  }
  let category = 'BUILD_FAILED';
  if (/OutOfMemoryError|Java heap space|GC overhead limit exceeded/.test(log)) {
    category = 'MEMORY_LIMIT';
  } else if (/not logged in|Not authenticated|Invalid Expo access token/i.test(log)) {
    category = 'EXPO_AUTHENTICATION';
  } else if (/ENOSPC|No space left on device/.test(log)) {
    category = 'DISK_SPACE';
  } else if (/ENOENT|command not found/.test(log)) {
    category = 'MISSING_TOOL_OR_FILE';
  }
  return { phase, category };
}
