// The composer's trigger/filter/insert contract, as assertions.
//
// Two things are being pinned here. The first is that a trigger character with
// no catalog behind it is a plain character -- the capability gate, which is the
// only reason a gateway that has never heard of composer descriptors is not made
// worse by this feature. The second is that the machine is generic: the same
// module answers for `/` at offset 0 and for `@` in the middle of a sentence,
// which is what #614 reuses.
import { describe, expect, test } from 'bun:test';

import {
  composerBackdropBottom,
  dismissComposerPopup,
  fuzzyScore,
  insertComposerPick,
  readComposerPopup,
  type ComposerPopupRow,
  type ComposerTrigger,
} from '../composer-popup';
import { paneComposerFromResponse, slashCommandTrigger } from '../pane-composer';

const COMMANDS = [
  { name: '/clear', description: 'Start a new session', args_hint: null, source: 'builtin' },
  {
    name: '/compact',
    description: 'Free up context by summarizing the conversation',
    args_hint: '[instructions]',
    source: 'builtin',
  },
  { name: '/context', description: 'Visualize context usage', args_hint: null, source: 'builtin' },
  { name: '/model', description: 'Set the AI model', args_hint: '[model]', source: 'builtin' },
  { name: '/review', description: 'Review a pull request', args_hint: '[pr]', source: 'builtin' },
  {
    name: '/release-notes',
    description: 'Draft the release notes',
    args_hint: null,
    source: 'workspace',
  },
];

function envelope(commands: unknown[] = COMMANDS, fileMentions = true) {
  return {
    schema_version: '1.3.0',
    capabilities: { parts: true, assets: true, image_upload: true, composer: true },
    data: {
      pane: {
        pane_id: 'wM:p1',
        agent: 'claude',
        composer: {
          version: 1,
          table: 'claude',
          captured_from: 'claude 2.1.220',
          slash_commands: commands,
          file_mentions: fileMentions,
        },
      },
      parts: [],
    },
  };
}

function catalog() {
  return paneComposerFromResponse(envelope())?.slashCommands ?? [];
}

function slash(draft: string, caret?: number, dismissedAt: number | null = null) {
  return readComposerPopup({
    draft,
    caret,
    dismissedAt,
    trigger: slashCommandTrigger(catalog()),
  });
}

function labels(rows: readonly ComposerPopupRow[]) {
  return rows.map((row) => row.label);
}

// ---------------------------------------------------------------------------

describe('the capability gate', () => {
  test('with no catalog the trigger character is plain text', () => {
    const state = readComposerPopup({ draft: '/', trigger: slashCommandTrigger([]) });

    expect(state.open).toBe(false);
    expect(state.reason).toBe('no-catalog');
    expect(state.rows).toEqual([]);
  });

  test('a catalog that is not a slash catalog raises nothing', () => {
    // An editor pane answers with `:w`, `:q`, `:wq`. Offering those under "/"
    // would be the app inventing a surface the pane does not have.
    const state = readComposerPopup({
      draft: '/',
      trigger: slashCommandTrigger([
        { name: ':w', description: 'Write the file', argsHint: '', source: 'builtin' },
        { name: ':q', description: 'Quit', argsHint: '', source: 'builtin' },
      ]),
    });

    expect(state.open).toBe(false);
    expect(state.reason).toBe('no-catalog');
  });

  test('an explicitly disabled trigger never even scans the draft', () => {
    const state = readComposerPopup({
      draft: '/comp',
      enabled: false,
      trigger: slashCommandTrigger(catalog()),
    });

    expect(state.open).toBe(false);
    expect(state.reason).toBe('no-catalog');
  });

  test('a gateway too old to describe a composer carries no descriptor', () => {
    expect(
      paneComposerFromResponse({
        schema_version: '1.0.0',
        capabilities: { parts: true },
        data: { parts: [] },
      })
    ).toBeNull();
  });

  test('a schema major this build has never seen is not read', () => {
    expect(paneComposerFromResponse({ ...envelope(), schema_version: '2.0.0' }, false)).toBeNull();
  });

  test('a descriptor with an empty table offers nothing rather than an empty list', () => {
    expect(paneComposerFromResponse(envelope([], false))).toBeNull();
  });
});

describe('the trigger', () => {
  test('"/" at position 0 opens the whole catalog', () => {
    const state = slash('/');

    expect(state.open).toBe(true);
    expect(state.rows).toHaveLength(COMMANDS.length);
    expect(state.query?.term).toBe('');
  });

  test('a slash anywhere but the start is an ordinary character', () => {
    expect(slash('cd /usr').open).toBe(false);
    expect(slash('look at src/lib').open).toBe(false);
    expect(slash('what about /compact').reason).toBe('no-query');
  });

  test('a space ends the query, because the rest is the argument', () => {
    expect(slash('/compact ').open).toBe(false);
    expect(slash('/compact everything').open).toBe(false);
  });

  test('a caret parked before the trigger is editing something else', () => {
    expect(slash('/clear', 0).open).toBe(true);
    expect(slash(' /clear', 0).open).toBe(false);
  });

  test('the caret follows the query rather than the end of the draft', () => {
    // Caret inside "/rev", with an argument already typed after it.
    const state = slash('/rev the diff', 4);

    expect(state.open).toBe(true);
    expect(state.query).toMatchObject({ start: 0, end: 4, text: '/rev', term: 'rev' });
  });
});

describe('the filter', () => {
  test('typing narrows the list by name', () => {
    expect(labels(slash('/co').rows)).toEqual(['/compact', '/context']);
  });

  test('the trigger character is optional in the term', () => {
    expect(labels(slash('/mod').rows)).toEqual(['/model']);
  });

  test('a scattered subsequence still matches', () => {
    expect(labels(slash('/rvw').rows)).toContain('/review');
  });

  test('a command found by its description ranks below every name match', () => {
    const rows = labels(slash('/context').rows);

    expect(rows[0]).toBe('/context');
    // "/compact" only matches through "Free up context by summarizing".
    expect(rows).toContain('/compact');
    expect(rows.indexOf('/compact')).toBeGreaterThan(rows.indexOf('/context'));
  });

  test('a short term is matched against names only', () => {
    // "co" is in "context", in "Claude Code", in "colored" -- answering the
    // second keystroke with half the catalog again is not a filter.
    expect(labels(slash('/co').rows)).toEqual(['/compact', '/context']);
  });

  test('a description is matched literally, not as a subsequence', () => {
    // "/model"'s description is "Set the AI model", which contains the letters
    // of "sam" in order and the word "model" outright.
    expect(labels(slash('/sam').rows)).not.toContain('/model');
    expect(labels(slash('/set').rows)).toContain('/model');
  });

  test('a term that matches nothing closes the popup instead of showing an empty box', () => {
    const state = slash('/zzzz');

    expect(state.open).toBe(false);
    expect(state.reason).toBe('no-match');
  });

  test('a prefix outranks a mid-word hit, and among equals the shorter wins', () => {
    expect(fuzzyScore('re', '/review')).toBeGreaterThan(fuzzyScore('re', '/clear') ?? -1);
    expect(fuzzyScore('re', '/review')).toBeGreaterThan(
      fuzzyScore('re', '/release-notes') ?? -1
    );
    expect(fuzzyScore('qq', '/review')).toBeNull();
  });

  test('filtering is case-insensitive', () => {
    expect(labels(slash('/MOD').rows)).toEqual(['/model']);
  });
});

describe('the rows', () => {
  test('a row carries the name, one line of description and the args hint', () => {
    const row = slash('/compact').rows[0];

    expect(row).toMatchObject({
      label: '/compact',
      description: 'Free up context by summarizing the conversation',
      hint: '[instructions]',
      badge: '',
      insert: '/compact',
    });
  });

  test('a workspace command is marked, because its name cannot say so', () => {
    expect(slash('/release').rows[0].badge).toBe('workspace');
    expect(slash('/model').rows[0].badge).toBe('');
  });

  test('the hint is never part of what gets inserted', () => {
    const row = slash('/model').rows[0];

    expect(row.insert).toBe('/model');
    expect(row.insert).not.toContain('[model]');
  });
});

describe('inserting', () => {
  test('a pick replaces the query with "/name " ready for its argument', () => {
    const state = slash('/comp');
    if (!state.open) throw new Error('expected the popup to be open');

    expect(insertComposerPick('/comp', state.query, state.rows[0])).toEqual({
      draft: '/compact ',
      caret: 9,
    });
  });

  test('the slash comes from the catalog, so a pick never doubles it', () => {
    const state = slash('/');
    if (!state.open) throw new Error('expected the popup to be open');

    expect(insertComposerPick('/', state.query, state.rows[0]).draft).toBe('/clear ');
  });

  test('an argument already typed survives the pick', () => {
    const state = slash('/rev the diff', 4);
    if (!state.open) throw new Error('expected the popup to be open');

    expect(insertComposerPick('/rev the diff', state.query, state.rows[0])).toEqual({
      draft: '/review the diff',
      caret: 7,
    });
  });
});

describe('dismissal', () => {
  test('Esc shuts the popup for the trigger it was pressed at', () => {
    const state = slash('/co');
    const at = dismissComposerPopup(state);

    expect(at).toBe(0);
    expect(slash('/co', undefined, at).reason).toBe('dismissed');
    // Still dismissed as the user keeps typing: they said no.
    expect(slash('/comp', undefined, at).reason).toBe('dismissed');
  });

  test('a dismissal is scoped to its offset, not to the whole composer', () => {
    const trigger: ComposerTrigger<{ path: string }> = {
      char: '@',
      anchor: 'word',
      items: [{ path: 'README.md' }, { path: 'src/app.ts' }],
      present: (item) => ({
        id: item.path,
        label: item.path,
        description: '',
        hint: '',
        badge: '',
        insert: `@${item.path}`,
      }),
    };

    expect(readComposerPopup({ draft: 'look at @src', trigger, dismissedAt: 8 }).open).toBe(false);
    // A second mention further along is a different question.
    expect(
      readComposerPopup({ draft: 'look at @src and @READ', trigger, dismissedAt: 8 }).open
    ).toBe(true);
  });

  test('deleting the trigger reports no-query, which is how a caller forgets Esc', () => {
    expect(slash('co', undefined, 0).reason).toBe('no-query');
  });
});

describe('reuse by the "@" trigger', () => {
  const trigger: ComposerTrigger<{ path: string; kind: string }> = {
    char: '@',
    anchor: 'word',
    items: [
      { path: 'src/app.tsx', kind: 'file' },
      { path: 'src/lib/theme.ts', kind: 'file' },
      { path: 'README.md', kind: 'file' },
    ],
    present: (item) => ({
      id: item.path,
      label: item.path,
      description: item.kind,
      hint: '',
      badge: '',
      insert: `@${item.path}`,
    }),
    limit: 2,
  };

  test('a word-anchored trigger opens mid-sentence', () => {
    const state = readComposerPopup({ draft: 'have a look at @theme', trigger });

    expect(state.open).toBe(true);
    expect(labels(state.rows)).toEqual(['src/lib/theme.ts']);
  });

  test('a trigger glued to a word is not a mention', () => {
    expect(readComposerPopup({ draft: 'mail me@example.com', trigger }).open).toBe(false);
  });

  test('the limit is honoured', () => {
    const state = readComposerPopup({ draft: '@s', trigger });

    expect(state.rows).toHaveLength(2);
  });

  test('a mid-sentence pick keeps the tail and puts the caret after the mention', () => {
    const draft = 'have a look at @theme please';
    const state = readComposerPopup({ draft, caret: 21, trigger });
    if (!state.open) throw new Error('expected the popup to be open');

    expect(insertComposerPick(draft, state.query, state.rows[0])).toEqual({
      draft: 'have a look at @src/lib/theme.ts please',
      caret: 32,
    });
  });
});

describe('the descriptor', () => {
  test('the gateway’s fields land on the app’s names', () => {
    const composer = paneComposerFromResponse(envelope());

    expect(composer).toMatchObject({
      version: 1,
      table: 'claude',
      capturedFrom: 'claude 2.1.220',
      fileMentions: true,
    });
    expect(composer?.slashCommands[5]).toEqual({
      name: '/release-notes',
      description: 'Draft the release notes',
      argsHint: '',
      source: 'workspace',
    });
  });

  test('an entry with no name is dropped, and a repeated one is not listed twice', () => {
    const composer = paneComposerFromResponse(
      envelope([
        { name: '/a', description: 'first', source: 'builtin' },
        { name: '', description: 'nameless', source: 'builtin' },
        { name: '/a', description: 'again', source: 'workspace' },
        'not an object',
      ])
    );

    expect(composer?.slashCommands).toHaveLength(1);
    expect(composer?.slashCommands[0].description).toBe('first');
  });

  test('a source the app has no name for is read as a builtin', () => {
    const composer = paneComposerFromResponse(
      envelope([{ name: '/a', description: '', source: 'plugin' }])
    );

    expect(composer?.slashCommands[0].source).toBe('builtin');
  });

  test('a pane that only offers file mentions is still a descriptor', () => {
    const composer = paneComposerFromResponse(envelope([], true));

    expect(composer?.fileMentions).toBe(true);
    expect(composer?.slashCommands).toEqual([]);
  });
});

/**
 * The regression these pin: the tap-outside backdrop was an absolute fill, so
 * its centre -- with the keyboard up, a pane strip in the dock and a
 * half-typed `/rel` in the field -- was the "zsh" chip. Aiming at the backdrop
 * switched pane instead of dismissing, and the message being written was left
 * pointed at the wrong pane.
 *
 * The numbers are the ones measured off the emulator the failure was found on
 * (1280x2856 at 480dpi), so the arithmetic is checked against a real layout
 * rather than a convenient one.
 */
describe('the dismissal backdrop', () => {
  const SCREEN_HEIGHT = 2856;
  const COMPOSER_HEIGHT = 548;
  // `useReanimatedKeyboardAnimation` reports the composer's translation, which
  // is negative while the keyboard is up.
  const KEYBOARD_UP = -1008;
  const KEYBOARD_DOWN = 0;

  /** Top edge of the composer overlay, in screen coordinates. */
  function composerTop(keyboardOffset: number): number {
    return SCREEN_HEIGHT + keyboardOffset - COMPOSER_HEIGHT;
  }

  /** Where a tool that taps an element by its bounds would tap. */
  function backdropCentreY(keyboardOffset: number): number {
    return (SCREEN_HEIGHT - composerBackdropBottom(COMPOSER_HEIGHT, keyboardOffset)) / 2;
  }

  test('with the keyboard down it stops at the top of the composer', () => {
    expect(composerBackdropBottom(COMPOSER_HEIGHT, KEYBOARD_DOWN)).toBe(COMPOSER_HEIGHT);
    expect(SCREEN_HEIGHT - composerBackdropBottom(COMPOSER_HEIGHT, KEYBOARD_DOWN)).toBe(
      composerTop(KEYBOARD_DOWN)
    );
  });

  test('it rises with the keyboard, by exactly as much as the composer does', () => {
    expect(composerBackdropBottom(COMPOSER_HEIGHT, KEYBOARD_UP)).toBe(COMPOSER_HEIGHT + 1008);
    expect(SCREEN_HEIGHT - composerBackdropBottom(COMPOSER_HEIGHT, KEYBOARD_UP)).toBe(
      composerTop(KEYBOARD_UP)
    );
  });

  test('its centre is over the pane, never over the composer', () => {
    expect(backdropCentreY(KEYBOARD_UP)).toBeLessThan(composerTop(KEYBOARD_UP));
    expect(backdropCentreY(KEYBOARD_DOWN)).toBeLessThan(composerTop(KEYBOARD_DOWN));
    // The bug, stated as the arithmetic that produced it: an absolute fill's
    // centre with the keyboard up was 1428, and the pane strip was at 1338.
    expect(SCREEN_HEIGHT / 2).toBeGreaterThan(composerTop(KEYBOARD_UP));
  });

  test('a composer that has not measured yet still leaves a tappable backdrop', () => {
    expect(composerBackdropBottom(0, KEYBOARD_DOWN)).toBe(0);
    expect(composerBackdropBottom(0, KEYBOARD_UP)).toBe(1008);
  });
});
