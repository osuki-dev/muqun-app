declare const Bun: {
  Glob: new (pattern: string) => {
    scan(options: { cwd: string; onlyFiles: boolean }): AsyncIterable<string>;
  };
  file(path: string): Blob & { lastModified: number; size: number };
  serve(options: {
    port: number;
    hostname: string;
    fetch(request: Request): Response | Promise<Response>;
  }): { url: URL };
};

type ApkArtifact = {
  name: string;
  path: string;
  size: number;
  modifiedAt: Date;
};

const projectDirectory = decodeURIComponent(
  new URL('../', import.meta.url).pathname.replace(/\/$/, '')
);
const artifactDirectories = [
  `${projectDirectory}/dist/eas-builds`,
  `${projectDirectory}/android/app/build/outputs/apk/release`,
];
const hostname = process.env.MUQUN_APK_HOST ?? '127.0.0.1';
const port = Number(process.env.MUQUN_APK_PORT ?? 8787);

async function latestApk(): Promise<ApkArtifact | null> {
  const candidates: ApkArtifact[] = [];
  const glob = new Bun.Glob('*.apk');
  for (const directory of artifactDirectories) {
    try {
      for await (const name of glob.scan({ cwd: directory, onlyFiles: true })) {
        const path = `${directory}/${name}`;
        const file = Bun.file(path);
        candidates.push({ name, path, size: file.size, modifiedAt: new Date(file.lastModified) });
      }
    } catch {
      // A build output directory may not exist until the first local build.
    }
  }

  return (
    candidates.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime())[0] ??
    null
  );
}

function apkHeaders(apk: NonNullable<Awaited<ReturnType<typeof latestApk>>>) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Disposition': 'attachment; filename="Muqun-latest.apk"',
    'Content-Length': String(apk.size),
    'Content-Type': 'application/vnd.android.package-archive',
    'Last-Modified': apk.modifiedAt.toUTCString(),
    'X-Muqun-Artifact': apk.name,
  };
}

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const apk = await latestApk();
      return Response.json(
        {
          ok: Boolean(apk),
          artifact: apk?.name ?? null,
          bytes: apk?.size ?? 0,
          modifiedAt: apk?.modifiedAt.toISOString() ?? null,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (url.pathname === '/muqun-latest.apk') {
      const apk = await latestApk();
      if (!apk) return new Response('No local APK is available.\n', { status: 404 });
      const headers = apkHeaders(apk);
      if (request.method === 'HEAD') return new Response(null, { headers });
      if (request.method !== 'GET') return new Response('Method not allowed.\n', { status: 405 });
      return new Response(Bun.file(apk.path), { headers });
    }

    if (url.pathname === '/') {
      const apk = await latestApk();
      const detail = apk
        ? `${apk.name} · ${(apk.size / 1024 / 1024).toFixed(1)} MiB`
        : 'No APK found';
      return new Response(
        `<!doctype html><meta name="viewport" content="width=device-width"><title>Muqun APK</title><style>body{font:16px system-ui;max-width:680px;margin:64px auto;padding:0 24px;color:#102033}a{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:12px;background:#1689ee;color:white;text-decoration:none}</style><h1>Muqun</h1><p>${detail}</p><a href="/muqun-latest.apk">Download latest APK</a>`,
        { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    return new Response('Not found.\n', { status: 404 });
  },
});

console.log(`Muqun APK server listening on ${server.url}`);
console.log(`Serving the newest APK from ${artifactDirectories.join(', ')}`);
