// The content model's guarantees, as assertions.
//
// The point of these is not that each payload parses -- it is that nothing the
// gateway can send makes content disappear. A type this build has never seen, a
// schema version from the future, a payload missing the field it needs: each of
// those still leaves the user with text on screen.
import { describe, expect, test } from 'bun:test';

import { hasEarlierPaneParts, panePartsFromResponse, type PanePart } from '../pane-parts';

function envelope(parts: unknown[], schemaVersion = '1.0.0', capabilities?: unknown) {
  return {
    schema_version: schemaVersion,
    capabilities: capabilities ?? { parts: true, assets: true, image_upload: true },
    data: { parts },
  };
}

describe('unknown part types', () => {
  test('a type this build does not know renders as its fallback', () => {
    const { parts } = panePartsFromResponse(
      envelope([{ type: 'future-thing', whatever: 1, fallback_text: 'Apply the fix? (yes / no)' }])
    );

    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('unknown');
    expect(parts[0].fallback_text).toBe('Apply the fix? (yes / no)');
  });

  test('the declared type is kept, so an unknown part is still identifiable', () => {
    const { parts } = panePartsFromResponse(
      envelope([{ type: 'approval', fallback_text: 'Allow?' }])
    );

    expect(parts[0]).toMatchObject({ type: 'unknown', declaredType: 'approval' });
  });

  test('an unknown part with no fallback is dropped rather than rendered blank', () => {
    const { parts } = panePartsFromResponse(envelope([{ type: 'future-thing' }]));

    expect(parts).toHaveLength(0);
  });

  test('a known type missing the payload it needs falls back too', () => {
    const { parts } = panePartsFromResponse(
      envelope([
        { type: 'tool-block', fallback_text: '⏺ Bash(ls)' },
        { type: 'todo', items: [], fallback_text: '☐ nothing' },
        { type: 'diff', hunks: [], fallback_text: '-a +b' },
        { type: 'asset-ref', fallback_text: 'report.md' },
      ])
    );

    expect(parts.map((part) => part.type)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(parts.map((part) => part.fallback_text)).toEqual([
      '⏺ Bash(ls)',
      '☐ nothing',
      '-a +b',
      'report.md',
    ]);
  });
});

describe('schema version', () => {
  test('a minor bump is read as usual, because additions are additive', () => {
    const { parts } = panePartsFromResponse(
      envelope([{ type: 'text', markdown: '# hi', fallback_text: 'hi' }], '1.7.0')
    );

    expect(parts[0]).toMatchObject({ type: 'text', markdown: '# hi' });
  });

  test('a major bump demotes every part to its fallback instead of guessing', () => {
    const { parts } = panePartsFromResponse(
      envelope(
        [
          { type: 'text', markdown: '# hi', fallback_text: 'hi' },
          { type: 'tool-block', tool: 'Bash', fallback_text: '⏺ Bash' },
        ],
        '2.0.0'
      )
    );

    expect(parts.map((part) => part.type)).toEqual(['unknown', 'unknown']);
    expect(parts.map((part) => part.fallback_text)).toEqual(['hi', '⏺ Bash']);
  });

  test('a missing or unparsable version is not treated as version 1', () => {
    const { parts } = panePartsFromResponse({
      capabilities: { parts: true },
      data: { parts: [{ type: 'text', markdown: '# hi', fallback_text: 'hi' }] },
    });

    expect(parts[0].type).toBe('unknown');
  });
});

describe('capabilities', () => {
  test('the envelope’s booleans are read straight through', () => {
    const { capabilities } = panePartsFromResponse(envelope([]));

    expect(capabilities).toEqual({
      parts: true,
      assets: true,
      imageUpload: true,
      composer: false,
    });
  });

  test('a per-pane strategy name counts as the capability being present', () => {
    const { capabilities } = panePartsFromResponse(
      envelope([], '1.0.0', { parts: 'dictionary', image_upload: 'file-path' })
    );

    expect(capabilities.parts).toBe(true);
    expect(capabilities.imageUpload).toBe(true);
    expect(capabilities.assets).toBe(false);
  });

  test('a response with no capabilities at all offers nothing', () => {
    expect(panePartsFromResponse({}).capabilities).toEqual({
      parts: false,
      assets: false,
      imageUpload: false,
      composer: false,
    });
    expect(panePartsFromResponse(null).parts).toEqual([]);
  });
});

describe('payloads', () => {
  test('a tool block keeps its result lines, status and truncation flag', () => {
    const { parts } = panePartsFromResponse(
      envelope([
        {
          type: 'tool-block',
          tool: 'Bash',
          input: 'cargo test',
          result: ['test result: ok. 60 passed', 42],
          status: 'error',
          truncated: true,
          fallback_text: '⏺ Bash(cargo test)',
        },
      ])
    );

    expect(parts[0]).toMatchObject({
      type: 'tool-block',
      tool: 'Bash',
      input: 'cargo test',
      // A non-string line is dropped rather than coerced: it is not output.
      result: ['test result: ok. 60 passed'],
      status: 'error',
      truncated: true,
    });
  });

  test('an unrecognised tool status settles on ok rather than dropping the block', () => {
    const { parts } = panePartsFromResponse(
      envelope([{ type: 'tool-block', tool: 'Read', status: 'pending', fallback_text: 'x' }])
    );

    expect(parts[0]).toMatchObject({ type: 'tool-block', status: 'ok', truncated: false });
  });

  test('todo items without text are skipped and done defaults to false', () => {
    const { parts } = panePartsFromResponse(
      envelope([
        {
          type: 'todo',
          items: [{ text: 'ship it', done: true }, { done: true }, { text: 'later' }],
          fallback_text: '☒ ship it',
        },
      ])
    );

    expect(parts[0]).toMatchObject({
      type: 'todo',
      items: [
        { text: 'ship it', done: true },
        { text: 'later', done: false },
      ],
    });
  });

  test('table cells are coerced to strings, and non-row entries dropped', () => {
    const { parts } = panePartsFromResponse(
      envelope([
        { type: 'table', rows: [['mode', 'result'], ['dark', 7], 'nope'], fallback_text: 't' },
      ])
    );

    expect(parts[0]).toMatchObject({
      type: 'table',
      rows: [
        ['mode', 'result'],
        ['dark', '7'],
      ],
    });
  });

  test('text falls back to its fallback when the markdown field is missing', () => {
    const { parts } = panePartsFromResponse(
      envelope([{ type: 'text', fallback_text: 'plain prose' }])
    );

    expect(parts[0]).toMatchObject({ type: 'text', markdown: 'plain prose' });
  });
});

describe('list identity', () => {
  test('a part is keyed by its source rows, so appending does not renumber', () => {
    const { parts } = panePartsFromResponse(
      envelope([
        { type: 'prompt', text: 'go', range: { start: 4, end: 4 }, fallback_text: '› go' },
        { type: 'status', text: 'Working…', fallback_text: '✻' },
      ])
    );

    expect(parts[0].id).toBe('r4-4');
    expect(parts[0].range).toEqual({ start: 4, end: 4 });
    // No range reported: the position in the response is all there is to key on.
    expect(parts[1].id).toBe('i1');
    expect(parts[1].range).toBe(undefined);
  });

  test('parts nested under data or sent bare are both found', () => {
    const bare = {
      schema_version: '1.0.0',
      capabilities: { parts: true },
      parts: [{ type: 'prompt', text: 'go', fallback_text: '› go' }],
    };

    expect(panePartsFromResponse(bare).parts).toHaveLength(1);
  });

  test('a non-object entry never reaches the list', () => {
    const { parts } = panePartsFromResponse(envelope([null, 'text', 7]));

    expect(parts).toHaveLength(0);
  });
});

// The per-pane composer descriptor rides the same answer, and the whole point of
// it is that `@` stays an ordinary character until a gateway says otherwise.
describe('the composer descriptor', () => {
  const withPane = (pane: unknown) => ({
    schema_version: '1.0.0',
    capabilities: { parts: true, assets: true, image_upload: true },
    data: { parts: [], pane },
  });

  test('file mentions are on only when the gateway says exactly true', () => {
    const { composer } = panePartsFromResponse(
      withPane({ pane_id: 'wA:p1', agent: 'claude', composer: { file_mentions: true } })
    );

    expect(composer).toMatchObject({ fileMentions: true });
  });

  test('a descriptor that does not mention the flag reads as off', () => {
    const { composer } = panePartsFromResponse(
      withPane({ pane_id: 'wA:p1', composer: { slash_commands: [] } })
    );

    expect(composer).toBeNull();
  });

  test('a truthy non-boolean is not a yes -- only `true` turns typing behaviour on', () => {
    const { composer } = panePartsFromResponse(
      withPane({ pane_id: 'wA:p1', composer: { file_mentions: 'yes' } })
    );

    expect(composer).toBeNull();
  });

  test('an agent the gateway has no table for carries no descriptor at all', () => {
    expect(panePartsFromResponse(withPane({ pane_id: 'wA:p2' })).composer).toBeNull();
  });

  test('a gateway too old to send a pane block is the same as no descriptor', () => {
    expect(panePartsFromResponse(envelope([])).composer).toBeNull();
  });

  test('a schema major nobody here has seen offers no composer either', () => {
    const { composer } = panePartsFromResponse({
      schema_version: '9.0.0',
      capabilities: { parts: true },
      data: { parts: [], pane: { composer: { file_mentions: true } } },
    });

    expect(composer).toBeNull();
  });
});

// Whether the chat view's pull-down has anything left to fetch. It has to agree
// with the raw view -- both read the same pane -- so it is answered from the
// gateway's own scroll metric wherever the gateway reports one.
describe('earlier transcript', () => {
  function part(start: number, end: number): PanePart {
    return {
      id: `r${start}-${end}`,
      fallback_text: 'x',
      type: 'text',
      markdown: 'x',
      range: { start, end },
    };
  }

  const scroll = { max_offset_from_bottom: 908, viewport_rows: 65 };

  test('the gateway metric decides while it is there', () => {
    // 908 rows above the viewport plus the 65 in it: 973 rows of transcript.
    expect(hasEarlierPaneParts([], 240, 2_000, scroll)).toBe(true);
    expect(hasEarlierPaneParts([], 960, 2_000, scroll)).toBe(true);
    expect(hasEarlierPaneParts([], 1_200, 2_000, scroll)).toBe(false);
  });

  test('the client maximum is the end of paging whatever the pane holds', () => {
    expect(hasEarlierPaneParts([], 2_000, 2_000, scroll)).toBe(false);
  });

  test('without metrics a transcript that fills its window has more above it', () => {
    expect(hasEarlierPaneParts([part(0, 120), part(121, 239)], 240, 2_000, undefined)).toBe(true);
  });

  test('without metrics a short transcript is the whole transcript', () => {
    expect(hasEarlierPaneParts([part(0, 10), part(11, 20)], 240, 2_000, undefined)).toBe(false);
  });

  test('parts with no ranges at all cover nothing rather than everything', () => {
    const ranged: PanePart = { id: 'i0', fallback_text: 'x', type: 'text', markdown: 'x' };
    expect(hasEarlierPaneParts([ranged], 240, 2_000, null)).toBe(false);
  });

  test('a malformed scroll block falls back rather than throwing', () => {
    expect(hasEarlierPaneParts([part(0, 239)], 240, 2_000, { viewport_rows: 'lots' })).toBe(true);
  });
});

// Which panes may be read as a conversation.
//
// The envelope's `capabilities.parts` is hardcoded `true` by every gateway that
// can normalize at all -- it says "this build knows how" and nothing about the
// pane in hand. `data.pane.parts` is the per-pane answer, and `text` means no
// marker table covered this pane, so its "transcript" is one block of screen
// scrapings. Gating the chat view on the former offered a conversation view for
// every agent the gateway has never heard of.
describe('which panes offer a conversation', () => {
  function paneEnvelope(pane: unknown) {
    return {
      schema_version: '1.4.0',
      capabilities: { parts: true, assets: true, image_upload: true, composer: true },
      data: { pane, parts: [] },
    };
  }

  test('a protocol that answered is a conversation', () => {
    const read = panePartsFromResponse(paneEnvelope({ pane_id: 'p1', parts: 'native' }));
    expect(read.source).toBe('native');
    expect(read.structured).toBe(true);
  });

  test('a marker table that matched is a conversation', () => {
    const read = panePartsFromResponse(paneEnvelope({ pane_id: 'p1', parts: 'dictionary' }));
    expect(read.source).toBe('dictionary');
    expect(read.structured).toBe(true);
  });

  test('prose the gateway could not type is not a conversation', () => {
    // The case the envelope flag cannot express: the gateway can normalize, and
    // for this pane it did not.
    const read = panePartsFromResponse(paneEnvelope({ pane_id: 'p1', parts: 'text' }));
    expect(read.source).toBe('text');
    expect(read.structured).toBe(false);
  });

  test('the gate is the pane, never the agent name', () => {
    // Same agent, two panes: one the adapter answered for, one it did not. An
    // agent-name allowlist would get both wrong in one direction or the other.
    const answered = paneEnvelope({ pane_id: 'p1', agent: 'codex', parts: 'native' });
    const scraped = paneEnvelope({ pane_id: 'p2', agent: 'codex', parts: 'text' });
    expect(panePartsFromResponse(answered).structured).toBe(true);
    expect(panePartsFromResponse(scraped).structured).toBe(false);
  });

  test('a gateway too old to declare a source falls back to its own flag', () => {
    const withFlag = panePartsFromResponse(paneEnvelope({ pane_id: 'p1' }));
    expect(withFlag.source).toBe('none');
    expect(withFlag.structured).toBe(true);

    const withoutFlag = panePartsFromResponse({
      schema_version: '1.0.0',
      capabilities: { parts: false },
      data: { pane: { pane_id: 'p1' }, parts: [] },
    });
    expect(withoutFlag.structured).toBe(false);
  });

  test('an older boolean in the pane block still means what it meant', () => {
    expect(panePartsFromResponse(paneEnvelope({ parts: true })).structured).toBe(true);
    expect(panePartsFromResponse(paneEnvelope({ parts: false })).structured).toBe(false);
  });

  test('a schema major nobody here has seen offers no conversation', () => {
    const read = panePartsFromResponse({
      schema_version: '9.0.0',
      capabilities: { parts: true },
      data: { pane: { pane_id: 'p1', parts: 'native' }, parts: [] },
    });
    expect(read.source).toBe('none');
    expect(read.structured).toBe(true);
  });

  test('a missing pane block is not a conversation claim', () => {
    expect(panePartsFromResponse(paneEnvelope(null)).source).toBe('none');
    expect(panePartsFromResponse(paneEnvelope('dictionary')).source).toBe('none');
    expect(panePartsFromResponse(paneEnvelope(['dictionary'])).source).toBe('none');
  });
});
