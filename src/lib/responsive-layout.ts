export const PAD_LAYOUT_MIN_WIDTH = 720;
export const PAD_RAIL_MIN_WIDTH = 232;
export const PAD_RAIL_MAX_WIDTH = 288;

const PAD_RAIL_WIDTH_RATIO = 0.25;

/**
 * The simulator preview's column.
 *
 * A fixed width, not a ratio, because what it holds is a device drawn at 1:1 --
 * an iPhone is 402pt wide whatever the window is, and a column that grew with
 * the window would only add margin around a picture that cannot use it. This is
 * that 402 plus the client's own chrome and gutters.
 */
export const PAD_PREVIEW_WIDTH = 452;

/**
 * What the terminal must keep for the preview to be allowed to open.
 *
 * About fifty-four columns at the default text size -- the cell advance is
 * 0.6em and the default is 13pt, so this is 420/7.8. Enough for the diffs and
 * tables an agent prints to still be worth reading; below it the reader would
 * be closing the preview to get their terminal back, so the layout declines
 * instead.
 *
 * Calibrated against the device rather than guessed, because the first guess
 * (480) was wrong in the way that matters. An 11-inch iPad in landscape is
 * 1210pt, which leaves 922 beside the rail and 470 after the preview -- ten
 * points short. The feature would have been dead on the most common iPad and
 * alive only on the 13-inch, which is exactly the kind of threshold nothing
 * reports: it does not fail, it silently never opens.
 */
export const PAD_TERMINAL_MIN_WIDTH = 420;

export type ResponsiveWorkspaceLayout = {
  mode: 'compact' | 'pad';
  availableWidth: number;
  railWidth: number;
  terminalWidth: number;
  /**
   * The simulator preview's column, or 0 when it is not showing.
   *
   * Its width comes out of the rail, which stands down to nothing while the
   * preview is up, rather than out of the terminal. Squeezing the rail was
   * never the alternative -- it is a list of names and stops being readable the
   * moment it narrows -- but hiding it outright costs only a tap to get back,
   * and hands the terminal the whole remainder.
   */
  previewWidth: number;
};

/**
 * Divides the currently available window width, including resized iPad windows.
 * Device type and orientation deliberately do not participate in this policy.
 */
export function responsiveWorkspaceLayout(
  availableWidth: number,
  /**
   * Whether the simulator preview is showing beside the terminal.
   *
   * Only ever true on a Pad: a phone that split this way would leave two
   * columns too narrow to be either a terminal or a device at 1:1, which is the
   * one thing the preview exists to be. The compact branch ignores it rather
   * than guarding at the call site.
   */
  showsPreview = false
): ResponsiveWorkspaceLayout {
  const safeWidth = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;

  if (safeWidth < PAD_LAYOUT_MIN_WIDTH) {
    return {
      mode: 'compact',
      availableWidth: safeWidth,
      railWidth: 0,
      terminalWidth: safeWidth,
      previewWidth: 0,
    };
  }

  const naturalRail = Math.min(
    PAD_RAIL_MAX_WIDTH,
    Math.max(PAD_RAIL_MIN_WIDTH, safeWidth * PAD_RAIL_WIDTH_RATIO)
  );

  // The preview only opens where both halves survive it. A device drawn at 1:1
  // needs its own width, and a terminal squeezed under `PAD_TERMINAL_MIN_WIDTH`
  // is a terminal showing so few columns that the reader would close the
  // preview to get it back -- so the app does not open it for them.
  //
  // Measured against the *whole* width, because the rail stands down entirely
  // while the preview is up rather than being squeezed (card #700, Ellen). The
  // rail is a list of names, so narrowing it is what breaks it -- but removing
  // it costs nothing that is not one tap away, and the two columns that remain
  // are the two the reader is actually looking at.
  //
  // This is also what makes the feature reachable at all. Beside a rail the
  // preview needs about 1160pt of window, which the 11-inch iPad clears by ten
  // points and every narrower window -- Split View, portrait -- misses
  // silently. Without it the floor is 872, so the same window opens the preview
  // with 758pt of terminal instead of 470.
  const previewWidth =
    showsPreview && safeWidth - PAD_PREVIEW_WIDTH >= PAD_TERMINAL_MIN_WIDTH
      ? PAD_PREVIEW_WIDTH
      : 0;
  const railWidth = previewWidth > 0 ? 0 : naturalRail;

  return {
    mode: 'pad',
    availableWidth: safeWidth,
    railWidth,
    terminalWidth: safeWidth - railWidth - previewWidth,
    previewWidth,
  };
}

/**
 * Where the home list stops growing on a wide window.
 *
 * A server card is one column of names, and a name set across the full width of
 * a landscape iPad is a line the eye has to travel back along to find the next
 * row. The measure is deliberately narrower than the workspace's, which is
 * showing a terminal and wants every column it can get.
 */
export const HOME_LIST_MEASURE = 680;

export type HomeServerListLayout = {
  mode: 'compact' | 'pad';
  /** The scroll content's own horizontal inset. */
  contentGutter: number;
  /** Where the centred list column stops growing. */
  contentMaxWidth: number;
  /** Between one server card and the next. */
  cardGap: number;
  /** A card's inset from its fill's edges. */
  cardPadding: number;
  cardRadius: number;
  /**
   * Between a card's identity block and its list of panes.
   *
   * The card draws nothing to say the panes belong to the machine above them --
   * it used to draw a tree, and this gap is what replaced it.
   *
   * Sized against the whitespace *between* two rows rather than against the row
   * pitch: a row is mostly air already, so a gap merely larger than the pitch
   * still reads as one more row. These are roughly twice the air between two
   * adjacent rows at the same density, which is where the break starts reading
   * as a break rather than as a slightly loose list.
   */
  listGap: number;
  /** How tall a pane row stands before its name wraps to a second line. */
  rowMinHeight: number;
  /**
   * How much of the screen the app's own name is allowed to take.
   *
   * `hero` is the empty screen: there is no machine to look at, so the brand
   * block *is* the content -- a 72pt mark, the name at 36, and the line saying
   * what the app is for. `mark` is every screen after that. The reader opened
   * this app to find out what one of their machines is doing; a poster for a
   * product they have already installed, twice the size of the card answering
   * that question, is the screen introducing itself to someone who has been
   * using it for months.
   *
   * The name does not disappear -- it stays as a mark, in the same place, at a
   * size that still reads as the top of a page rather than as a toolbar. What it
   * stops doing is outranking the machine.
   */
  brand: HomeBrandWeight;
};

/**
 * The brand block's two weights. Both are real layouts, not a scale factor: the
 * tagline belongs to exactly one of them, and the wordmark's tracking is pulled
 * in harder the larger it is set.
 */
export type HomeBrandWeight = {
  weight: 'hero' | 'mark';
  /**
   * The app mark, drawn straight onto the page.
   *
   * It used to sit in a rounded tile with a fill and a drop shadow, and the
   * mark itself was 70% of that -- so the thing the eye was meant to read was
   * the smallest part of it, and the tile repeated a shape the mark already
   * has. Standing it on the background gives the same footprint to the mark
   * alone (Ellen), which is both larger and quieter than the tile it replaces.
   */
  markSize: number;
  /** The wordmark. Tracking is pulled in harder the larger it is set. */
  titleSize: number;
  titleLineHeight: number;
  titleTracking: number;
  /** Between the tile and the wordmark. */
  gap: number;
  /** The block's own minimum height, so the header does not resize under it. */
  minHeight: number;
  /** Whether "Your agents, anywhere." is on screen. */
  showsTagline: boolean;
};

const HOME_BRAND_HERO: HomeBrandWeight = {
  weight: 'hero',
  markSize: 72,
  titleSize: 36,
  titleLineHeight: 41,
  titleTracking: -1.2,
  gap: 15,
  minHeight: 88,
  showsTagline: true,
};

const HOME_BRAND_MARK: HomeBrandWeight = {
  weight: 'mark',
  markSize: 46,
  titleSize: 26,
  titleLineHeight: 31,
  titleTracking: -0.8,
  gap: 12,
  minHeight: 56,
  showsTagline: false,
};

/**
 * Which weight the app's name is set at, for a given number of paired machines.
 *
 * Width does not participate. A tablet has more room, not less to say: the
 * question is whether the screen has content of its own yet, and that is the
 * same question in both modes.
 */
export function homeBrandWeight(serverCount: number): HomeBrandWeight {
  return serverCount === 0 ? HOME_BRAND_HERO : HOME_BRAND_MARK;
}

/**
 * The home list's geometry, for one window width and one server count.
 *
 * Density is a question about room, and room has two sources: a wide window has
 * it outright, and a one-machine list has it because there is nothing else on
 * the screen. So a pad window is always roomy regardless of how many servers are
 * paired, while a phone earns the taller rows only while it is showing a single
 * card. Deciding both here rather than at two call sites is what keeps a pad
 * from inheriting the phone's crowded answer the moment a second server pairs.
 */
export function homeServerListLayout(
  availableWidth: number,
  serverCount: number
): HomeServerListLayout {
  const safeWidth = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;

  if (safeWidth >= PAD_LAYOUT_MIN_WIDTH) {
    return {
      mode: 'pad',
      contentGutter: 32,
      contentMaxWidth: HOME_LIST_MEASURE,
      cardGap: 24,
      cardPadding: 22,
      cardRadius: 24,
      listGap: 30,
      rowMinHeight: 44,
      brand: homeBrandWeight(serverCount),
    };
  }

  const spacious = serverCount <= 1;
  return {
    mode: 'compact',
    contentGutter: 18,
    // Never binds below the pad threshold; the field stays a number so callers
    // do not have to branch on whether there is a cap at all.
    contentMaxWidth: safeWidth,
    cardGap: 24,
    cardPadding: spacious ? 18 : 14,
    cardRadius: 20,
    listGap: spacious ? 28 : 22,
    rowMinHeight: spacious ? 40 : 34,
    brand: homeBrandWeight(serverCount),
  };
}
