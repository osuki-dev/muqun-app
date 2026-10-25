/** Gateway uploads have generated UUID names, never a client-supplied filename. */
export function gatewayUploadName(path: string): string | null {
  const absolute = path.startsWith('file:///') ? path.slice('file://'.length) : path;
  if (!absolute.startsWith('/') || /[\\%?#\u0000-\u001f\u007f]/.test(absolute)) return null;
  const segments = absolute.split('/');
  if (segments.slice(1).some((segment) => !segment || segment === '.' || segment === '..'))
    return null;
  return (
    /\/muqun-gateway\/uploads\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.[a-z\d]{1,10})$/i.exec(
      absolute
    )?.[1] ?? null
  );
}

/** Recover the exact ByPath handoff suffix from canonical history, including after reload. */
export function splitUploadedAttachmentSuffix(text: string): {
  text: string;
  attachments: string[];
} {
  const marker = '\n\nAttached files (on this host):';
  const start = text.lastIndexOf(marker);
  if (start < 0) return { text, attachments: [] };
  // Examples inside a code fence are prose, not a transport attachment envelope.
  let fence: string | undefined;
  for (const line of text.slice(0, start).split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim())
      fence = undefined;
  }
  if (fence) return { text, attachments: [] };
  const lines = text
    .slice(start + marker.length)
    .replace(/\n$/, '')
    .split('\n');
  if (lines.shift() !== '' || !lines.length) return { text, attachments: [] };
  const attachments: string[] = [];
  for (const line of lines) {
    const path = line.startsWith('- ') ? line.slice(2) : '';
    if (!gatewayUploadName(path)) return { text, attachments: [] };
    attachments.push(path);
  }
  return { text: text.slice(0, start), attachments };
}
