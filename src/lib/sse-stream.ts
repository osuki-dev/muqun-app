export type ServerSentEvent = {
  event: string;
  data: string;
};

/** Incrementally parses an SSE byte stream after UTF-8 decoding. */
export class ServerSentEventParser {
  private buffer = '';

  push(chunk: string): ServerSentEvent[] {
    this.buffer += chunk;
    const events: ServerSentEvent[] = [];

    while (true) {
      const boundary = this.findBoundary();
      if (!boundary) break;

      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      const event = parseEventBlock(block);
      if (event) events.push(event);
    }

    return events;
  }

  private findBoundary(): { index: number; length: number } | null {
    const match = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer);
    return match ? { index: match.index, length: match[0].length } : null;
  }
}

function parseEventBlock(block: string): ServerSentEvent | null {
  let event = 'message';
  const data: string[] = [];

  for (const line of block.split(/\r\n|\n|\r/)) {
    if (!line || line.startsWith(':')) continue;

    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value || 'message';
    if (field === 'data') data.push(value);
  }

  return data.length > 0 ? { event, data: data.join('\n') } : null;
}
