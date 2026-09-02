import { describe, expect, test } from 'bun:test';

import {
  homeBrandWeight,
  homeServerListLayout,
  HOME_LIST_MEASURE,
  PAD_LAYOUT_MIN_WIDTH,
  PAD_PREVIEW_WIDTH,
  PAD_RAIL_MAX_WIDTH,
  PAD_RAIL_MIN_WIDTH,
  PAD_TERMINAL_MIN_WIDTH,
  responsiveWorkspaceLayout,
} from '../responsive-layout';

describe('responsive workspace mode', () => {
  test('stays compact immediately below the pad breakpoint', () => {
    expect(responsiveWorkspaceLayout(PAD_LAYOUT_MIN_WIDTH - 1)).toEqual({
      mode: 'compact',
      availableWidth: PAD_LAYOUT_MIN_WIDTH - 1,
      railWidth: 0,
      terminalWidth: PAD_LAYOUT_MIN_WIDTH - 1,
      previewWidth: 0,
    });
  });

  test('becomes a split pad workspace at the breakpoint', () => {
    expect(responsiveWorkspaceLayout(PAD_LAYOUT_MIN_WIDTH)).toEqual({
      mode: 'pad',
      availableWidth: PAD_LAYOUT_MIN_WIDTH,
      railWidth: PAD_RAIL_MIN_WIDTH,
      terminalWidth: PAD_LAYOUT_MIN_WIDTH - PAD_RAIL_MIN_WIDTH,
      previewWidth: 0,
    });
  });

  test('uses the window width rather than a device classification', () => {
    expect(responsiveWorkspaceLayout(600).mode).toBe('compact');
    expect(responsiveWorkspaceLayout(1024).mode).toBe('pad');
  });
});

describe('pad workspace widths', () => {
  test('keeps the rail at its minimum on the narrow end', () => {
    const layout = responsiveWorkspaceLayout(800);

    expect(layout.railWidth).toBe(PAD_RAIL_MIN_WIDTH);
    expect(layout.terminalWidth).toBe(800 - PAD_RAIL_MIN_WIDTH);
  });

  test('lets the rail grow with the available width', () => {
    const layout = responsiveWorkspaceLayout(1024);

    expect(layout.railWidth).toBe(256);
    expect(layout.terminalWidth).toBe(768);
  });

  test('caps the rail on a wide window and gives the remainder to the terminal', () => {
    const layout = responsiveWorkspaceLayout(1366);

    expect(layout.railWidth).toBe(PAD_RAIL_MAX_WIDTH);
    expect(layout.terminalWidth).toBe(1366 - PAD_RAIL_MAX_WIDTH);
  });

  test('always accounts for the complete available width', () => {
    for (const availableWidth of [0, 719, 720, 800, 1024, 1366]) {
      const layout = responsiveWorkspaceLayout(availableWidth);
      expect(layout.railWidth + layout.terminalWidth).toBe(layout.availableWidth);
    }
  });
});

describe('invalid measurements', () => {
  test('treats negative and non-finite widths as an empty compact window', () => {
    for (const availableWidth of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(responsiveWorkspaceLayout(availableWidth)).toEqual({
        mode: 'compact',
        availableWidth: 0,
        railWidth: 0,
        terminalWidth: 0,
        previewWidth: 0,
      });
    }
  });
});

describe('home server list density', () => {
  test('spends the room a single machine leaves on the phone', () => {
    const alone = homeServerListLayout(390, 1);
    const crowded = homeServerListLayout(390, 4);

    expect(alone.rowMinHeight).toBeGreaterThan(crowded.rowMinHeight);
    expect(alone.cardPadding).toBeGreaterThan(crowded.cardPadding);
    expect(alone.listGap).toBeGreaterThan(crowded.listGap);
  });

  test('an empty phone list is as roomy as a one-server list', () => {
    const { brand: emptyBrand, ...empty } = homeServerListLayout(390, 0);
    const { brand: oneBrand, ...one } = homeServerListLayout(390, 1);

    // Density is the same question either way. The brand block is not: with no
    // machine on screen it is the content, and with one it is a mark.
    expect(empty).toEqual(one);
    expect(emptyBrand.weight).toBe('hero');
    expect(oneBrand.weight).toBe('mark');
  });

  // The regression this guards: density used to be `serverCount <= 1` alone, so
  // pairing a second machine handed a landscape tablet the phone's crowded card.
  test('a pad window stays roomy however many machines are paired', () => {
    const one = homeServerListLayout(1280, 1);
    const many = homeServerListLayout(1280, 9);

    expect(many).toEqual(one);
    expect(many.rowMinHeight).toBeGreaterThan(homeServerListLayout(390, 1).rowMinHeight);
  });
});

describe('home server list measure', () => {
  test('lets the column fill a phone window', () => {
    expect(homeServerListLayout(390, 1)).toMatchObject({
      mode: 'compact',
      contentMaxWidth: 390,
    });
  });

  test('caps the column on a wide window so names keep a readable measure', () => {
    for (const availableWidth of [PAD_LAYOUT_MIN_WIDTH, 1024, 1366, 2048]) {
      const layout = homeServerListLayout(availableWidth, 1);

      expect(layout.mode).toBe('pad');
      expect(layout.contentMaxWidth).toBe(HOME_LIST_MEASURE);
      expect(layout.contentMaxWidth).toBeLessThan(availableWidth);
    }
  });

  test('switches on the same breakpoint the workspace uses', () => {
    expect(homeServerListLayout(PAD_LAYOUT_MIN_WIDTH - 1, 1).mode).toBe('compact');
    expect(homeServerListLayout(PAD_LAYOUT_MIN_WIDTH, 1).mode).toBe('pad');
  });

  test('treats a negative or non-finite width as an empty compact window', () => {
    for (const availableWidth of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(homeServerListLayout(availableWidth, 1)).toMatchObject({
        mode: 'compact',
        contentMaxWidth: 0,
      });
    }
  });
});

describe('home card grouping', () => {
  // With no connector line drawn, this gap is the only thing saying the panes
  // belong to the machine above them rather than being one more row of it.
  test('separates the identity block from the list by more than one row pitch', () => {
    for (const [availableWidth, serverCount] of [
      [390, 1],
      [390, 4],
      [1280, 1],
    ] as const) {
      const layout = homeServerListLayout(availableWidth, serverCount);
      expect(layout.listGap).toBeGreaterThan(layout.rowMinHeight / 2);
    }
  });
});

describe('home brand weight', () => {
  test('is the content of an empty screen and a mark on a populated one', () => {
    expect(homeBrandWeight(0).weight).toBe('hero');
    expect(homeBrandWeight(0).showsTagline).toBe(true);

    for (const serverCount of [1, 2, 9]) {
      expect(homeBrandWeight(serverCount).weight).toBe('mark');
      expect(homeBrandWeight(serverCount).showsTagline).toBe(false);
    }
  });

  test('the mark is smaller than the hero in every dimension that carries it', () => {
    const hero = homeBrandWeight(0);
    const mark = homeBrandWeight(1);

    expect(mark.tileSize).toBeLessThan(hero.tileSize);
    expect(mark.tileRadius).toBeLessThan(hero.tileRadius);
    expect(mark.titleSize).toBeLessThan(hero.titleSize);
    expect(mark.minHeight).toBeLessThan(hero.minHeight);
    // Tracking is pulled in harder the larger the name is set, so the smaller
    // weight is the *less* negative of the two.
    expect(mark.titleTracking).toBeGreaterThan(hero.titleTracking);
  });

  test('a wide window does not make the brand louder', () => {
    // Room is not the question the brand block answers -- content is -- so the
    // pad branch and the phone branch have to reach the same weight.
    expect(homeServerListLayout(1280, 2).brand).toEqual(homeServerListLayout(390, 2).brand);
    expect(homeServerListLayout(1280, 0).brand).toEqual(homeServerListLayout(390, 0).brand);
  });
});

describe('the simulator preview column', () => {
  test('stands the rail down rather than squeezing either column', () => {
    // The rail is a list of names, so narrowing it is what breaks it. It yields
    // entirely instead, and the terminal keeps everything the preview does not
    // take -- which is more than it had before the preview opened, not less.
    const wide = 1366;
    const without = responsiveWorkspaceLayout(wide);
    const with_ = responsiveWorkspaceLayout(wide, true);
    expect(without.railWidth).toBeGreaterThan(0);
    expect(with_.railWidth).toBe(0);
    expect(with_.previewWidth).toBe(PAD_PREVIEW_WIDTH);
    expect(with_.terminalWidth).toBe(wide - PAD_PREVIEW_WIDTH);
    expect(with_.terminalWidth).toBeGreaterThan(without.terminalWidth - PAD_PREVIEW_WIDTH);
    // Nothing is lost or invented between the columns.
    expect(with_.railWidth + with_.terminalWidth + with_.previewWidth).toBe(wide);
  });

  test('opens on the windows a rail used to shut it out of', () => {
    // The whole point of standing the rail down: beside one, the preview needed
    // about 1160pt and quietly never opened below that. These are real windows
    // an iPad hands the app -- an 11-inch Split View share, and the width where
    // the terminal exactly meets its floor.
    const splitView = 981;
    expect(responsiveWorkspaceLayout(splitView, true).previewWidth).toBe(PAD_PREVIEW_WIDTH);
    expect(responsiveWorkspaceLayout(splitView, true).railWidth).toBe(0);

    const floor = PAD_PREVIEW_WIDTH + PAD_TERMINAL_MIN_WIDTH;
    expect(responsiveWorkspaceLayout(floor, true).previewWidth).toBe(PAD_PREVIEW_WIDTH);
    expect(responsiveWorkspaceLayout(floor, true).terminalWidth).toBe(PAD_TERMINAL_MIN_WIDTH);
    expect(responsiveWorkspaceLayout(floor - 1, true).previewWidth).toBe(0);
  });

  test('gives the rail back the moment the preview closes', () => {
    const wide = 1210;
    const closed = responsiveWorkspaceLayout(wide, false);
    expect(closed.railWidth).toBeGreaterThan(0);
    expect(closed.previewWidth).toBe(0);
    expect(closed.railWidth + closed.terminalWidth).toBe(wide);
  });

  test('declines to open where it would leave an unreadable terminal', () => {
    // A device at 1:1 needs its own width. Below this the reader would close
    // the preview to get their terminal back, so the layout does not open it.
    const tight = PAD_LAYOUT_MIN_WIDTH;
    const layout = responsiveWorkspaceLayout(tight, true);
    expect(layout.previewWidth).toBe(0);
    expect(layout.terminalWidth).toBe(tight - layout.railWidth);
  });

  test('opens at the first width where both halves survive', () => {
    // Walk up until it opens, and check the terminal really did keep its floor.
    let width = PAD_LAYOUT_MIN_WIDTH;
    while (width < 2400 && responsiveWorkspaceLayout(width, true).previewWidth === 0) {
      width += 1;
    }
    const layout = responsiveWorkspaceLayout(width, true);
    expect(layout.previewWidth).toBe(PAD_PREVIEW_WIDTH);
    expect(layout.terminalWidth).toBeGreaterThanOrEqual(PAD_TERMINAL_MIN_WIDTH);
    // One point narrower and it is still closed, so this is the real edge.
    expect(responsiveWorkspaceLayout(width - 1, true).previewWidth).toBe(0);
  });

  test('a phone is never split, whatever it is asked for', () => {
    const layout = responsiveWorkspaceLayout(402, true);
    expect(layout.mode).toBe('compact');
    expect(layout.previewWidth).toBe(0);
    expect(layout.terminalWidth).toBe(402);
  });
});

describe('the widths the preview actually meets', () => {
  // Measured from the simulators, in logical points. The first cut of
  // PAD_TERMINAL_MIN_WIDTH was ten points too high and closed the preview on
  // the most common iPad, so the sizes are pinned rather than reasoned about.
  const IPAD_11_LANDSCAPE = 1210;
  const IPAD_11_PORTRAIT = 834;
  const IPAD_13_LANDSCAPE = 1366;

  test('opens on an 11-inch iPad in landscape', () => {
    const layout = responsiveWorkspaceLayout(IPAD_11_LANDSCAPE, true);
    expect(layout.previewWidth).toBe(PAD_PREVIEW_WIDTH);
    expect(layout.terminalWidth).toBeGreaterThanOrEqual(PAD_TERMINAL_MIN_WIDTH);
  });

  test('opens on a 13-inch iPad in landscape', () => {
    expect(responsiveWorkspaceLayout(IPAD_13_LANDSCAPE, true).previewWidth).toBe(
      PAD_PREVIEW_WIDTH
    );
  });

  test('declines in portrait, where neither half would survive', () => {
    expect(responsiveWorkspaceLayout(IPAD_11_PORTRAIT, true).previewWidth).toBe(0);
  });
});
