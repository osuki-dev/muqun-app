export const PAD_LAYOUT_MIN_WIDTH = 720;
export const PAD_RAIL_MIN_WIDTH = 232;
export const PAD_RAIL_MAX_WIDTH = 288;

const PAD_RAIL_WIDTH_RATIO = 0.25;

export type ResponsiveWorkspaceLayout = {
  mode: 'compact' | 'pad';
  availableWidth: number;
  railWidth: number;
  terminalWidth: number;
};

/**
 * Divides the currently available window width, including resized iPad windows.
 * Device type and orientation deliberately do not participate in this policy.
 */
export function responsiveWorkspaceLayout(availableWidth: number): ResponsiveWorkspaceLayout {
  const safeWidth = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;

  if (safeWidth < PAD_LAYOUT_MIN_WIDTH) {
    return {
      mode: 'compact',
      availableWidth: safeWidth,
      railWidth: 0,
      terminalWidth: safeWidth,
    };
  }

  const railWidth = Math.min(
    PAD_RAIL_MAX_WIDTH,
    Math.max(PAD_RAIL_MIN_WIDTH, safeWidth * PAD_RAIL_WIDTH_RATIO)
  );

  return {
    mode: 'pad',
    availableWidth: safeWidth,
    railWidth,
    terminalWidth: safeWidth - railWidth,
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
 * tagline belongs to exactly one of them, and a tile that shrinks by a third
 * needs a corner radius that shrinks with it or it stops looking like the same
 * object.
 */
export type HomeBrandWeight = {
  weight: 'hero' | 'mark';
  /** The rounded tile the app mark sits in. */
  tileSize: number;
  tileRadius: number;
  /**
   * Cast from the tile. It travels with the tile because a drop shadow is a
   * statement about how far off the page something is sitting, and one sized
   * for a 72pt mark under a 46pt one reads as a smudge rather than as lift.
   */
  tileShadow: string;
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
  tileSize: 72,
  tileRadius: 21,
  tileShadow: '0 10px 26px rgba(0, 0, 0, 0.10)',
  titleSize: 36,
  titleLineHeight: 41,
  titleTracking: -1.2,
  gap: 15,
  minHeight: 88,
  showsTagline: true,
};

const HOME_BRAND_MARK: HomeBrandWeight = {
  weight: 'mark',
  tileSize: 46,
  tileRadius: 14,
  tileShadow: '0 5px 14px rgba(0, 0, 0, 0.08)',
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
