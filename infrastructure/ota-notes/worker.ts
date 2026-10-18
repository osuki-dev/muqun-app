import { d1Database, r2Storage } from '@hot-updater/cloudflare/worker';
import { createHotUpdater } from '@hot-updater/server';
import { apiKeys, insights, remoteConfig } from '@hot-updater/server/plugins';
import { localizedReleaseNotes } from './plugin';

type WorkerEnvironment = {
  DB: Parameters<typeof d1Database>[0];
  BUCKET: Parameters<typeof r2Storage>[0]['bucket'];
  ACCOUNT_ID: string;
  BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
};

function createServer(env: WorkerEnvironment) {
  const storage = r2Storage({
    bucket: env.BUCKET,
    bucketName: env.BUCKET_NAME,
    accountId: env.ACCOUNT_ID,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  return createHotUpdater({
    database: d1Database(env.DB),
    storage,
    plugins: [apiKeys(), insights(), remoteConfig(), localizedReleaseNotes()],
  });
}
const servers = new WeakMap<WorkerEnvironment, ReturnType<typeof createServer>>();

/** Only client handlers are mounted. Provider-backed tooling writes notes directly. */
export default {
  fetch(request: Request, env: WorkerEnvironment) {
    let server = servers.get(env);
    if (!server) {
      server = createServer(env);
      servers.set(env, server);
    }
    return server.handlers.client(request);
  },
};
