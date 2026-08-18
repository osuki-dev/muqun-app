/**
 * The gap between the safe-area inset and the app's nav chrome (card #624).
 *
 * Every header in the app -- the server page's floating pills, the pushed-screen
 * header, the home screen's top bar -- sat directly on the inset, so the row
 * began at the first pixel the system would allow. On a Dynamic Island phone the
 * pills ended up level with the island, and on an Android punch-hole display
 * they touched the status bar outright. The inset says where drawing may start;
 * it does not say where a control should sit.
 *
 * One number rather than three, so the three headers cannot drift apart. It is
 * added to the inset (`SafeAreaView` edges are additive), never instead of it.
 */
export const NAV_HEADER_TOP_GAP = 10;
