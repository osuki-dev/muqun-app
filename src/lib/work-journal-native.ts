import * as SecureStore from 'expo-secure-store';
import { createWorkJournalRouter } from './work-journal-routing';
import { createWorkJournal, type WorkJournalScope, type WorkJournalStorage } from './work-journal';

const KEY = 'muqun.work.pending-intents.v1';
// Keep the storage address stable: createWorkJournal reads v1 and atomically
// upgrades its envelope to v2 on the next write, preserving both pending lanes.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
// One adapter identity also serializes every journal's read/modify/write in this JS runtime.
const storage: WorkJournalStorage = {
  read: () => SecureStore.getItemAsync(KEY, OPTIONS),
  write: (value) => SecureStore.setItemAsync(KEY, value, OPTIONS),
};
export function createSecureWorkJournal(scope: WorkJournalScope) {
  return createWorkJournal(storage, scope);
}

// Demo backend records are also process-local; production has no in-memory fallback.
export const createRecordWorkJournal = createWorkJournalRouter(createSecureWorkJournal);
