import type { GatewayRecord } from './gateway-storage';
import { DEMO_PAIRING_SERVER_ID } from './pairing';
import {
  createWorkJournal,
  type WorkJournalPort,
  type WorkJournalScope,
  type WorkJournalStorage,
} from './work-journal';

/** Instantiate once beside the demo transport: both histories end with this JS process. */
export function createWorkJournalRouter(
  secureJournal: (scope: WorkJournalScope) => WorkJournalPort
) {
  let demoValue: string | null = null;
  const demoStorage: WorkJournalStorage = {
    read: async () => demoValue,
    write: async (value) => {
      demoValue = value;
    },
  };
  return (record: Pick<GatewayRecord, 'serverId'>, scope: WorkJournalScope): WorkJournalPort => {
    // This is an explicit fixture identity, never a response to a real storage failure.
    if (record.serverId === DEMO_PAIRING_SERVER_ID) return createWorkJournal(demoStorage, scope);
    return secureJournal(scope);
  };
}
