import { describe, expect, test } from 'bun:test';

import {
  COMPOSER_RESERVE_FALLBACK,
  emptyCardBottomReserve,
  emptyCardTopReserve,
} from '@/lib/agent-empty-layout';

/**
 * The card's centre, as the two reserves put it, in a screen `height` tall.
 *
 * `justifyContent: 'center'` centres the child in what the paddings leave, so
 * the centre of the card is the centre of that band -- which is the whole of
 * what these two numbers decide.
 */
function cardCentre(opts: {
  height: number;
  topInset: number;
  noticeReserve: number;
  dockHeight: number;
  bottomInset: number;
}) {
  const top = opts.noticeReserve + emptyCardTopReserve(opts.topInset, opts.noticeReserve);
  const bottom = opts.height - emptyCardBottomReserve(opts.dockHeight, opts.bottomInset);
  return (top + bottom) / 2;
}

describe('emptyCardTopReserve', () => {
  test('is the whole header inset when no notice is up', () => {
    expect(emptyCardTopReserve(132, 0)).toBe(132);
  });

  test('gives the notice reserve back, so a notice never moves the card', () => {
    expect(emptyCardTopReserve(132, 40)).toBe(92);
    // A notice taller than the header inset: the margin goes negative and the
    // card's band still starts at the header.
    expect(emptyCardTopReserve(132, 180)).toBe(-48);
  });

  test('never counts the header twice: the notice reserve is taken back in full', () => {
    // The old bug was 132 + 181 of padding for a notice whose bottom edge is
    // at 181, which put the card in the lower half of the screen. The reserve
    // is subtracted in full, so the transcript area's own padding plus this
    // margin always comes to the header inset.
    expect(181 + emptyCardTopReserve(132, 181)).toBe(132);
    expect(400 + emptyCardTopReserve(0, 400)).toBe(0);
  });
});

describe('emptyCardBottomReserve', () => {
  test('is the dock, once the dock has been measured', () => {
    expect(emptyCardBottomReserve(176, 24)).toBe(176);
  });

  test('falls back to the guess plus the safe area until then', () => {
    expect(emptyCardBottomReserve(0, 24)).toBe(24 + COMPOSER_RESERVE_FALLBACK);
  });

  test('a measured dock is used even when it is shorter than the guess', () => {
    // The offline composer is about 117pt tall; the old constant floated the
    // card 30pt above where it belonged.
    expect(emptyCardBottomReserve(117, 0)).toBe(117);
  });
});

describe('the card centres between the header and the composer', () => {
  /** Both portrait phones this ships on, in points. */
  const PHONES = [
    { name: 'compact phone', height: 667 },
    { name: 'tall phone', height: 914 },
  ];

  for (const phone of PHONES) {
    test(`${phone.name}: centred in the free room, no notice`, () => {
      const topInset = 132;
      const dockHeight = 176;
      const centre = cardCentre({
        height: phone.height,
        topInset,
        noticeReserve: 0,
        dockHeight,
        bottomInset: 0,
      });
      expect(centre).toBeCloseTo((topInset + (phone.height - dockHeight)) / 2, 5);
    });

    test(`${phone.name}: a notice, even one past the inset, does not move the card`, () => {
      const topInset = 132;
      const dockHeight = 176;
      const noticeReserve = 181;
      const centre = cardCentre({
        height: phone.height,
        topInset,
        noticeReserve,
        dockHeight,
        bottomInset: 0,
      });
      expect(centre).toBeCloseTo((topInset + (phone.height - dockHeight)) / 2, 5);
    });

    test(`${phone.name}: a taller composer lowers the top of the card by half its growth`, () => {
      const base = cardCentre({
        height: phone.height,
        topInset: 132,
        noticeReserve: 0,
        dockHeight: 176,
        bottomInset: 0,
      });
      const taller = cardCentre({
        height: phone.height,
        topInset: 132,
        noticeReserve: 0,
        dockHeight: 276,
        bottomInset: 0,
      });
      expect(base - taller).toBeCloseTo(50, 5);
    });
  }
});
