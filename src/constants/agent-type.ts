/**
 * The type scale of the agent transcript: four sizes, and nothing in between.
 *
 * Everything the agent surface sets in points comes from here, so a tool
 * header, a notice, a chip and a caption cannot each decide their own size.
 * Prose and code are the markdown renderer's own (`createMarkdownStyle`) and
 * read the same two entries, so a code block in a tool card and a fence in a
 * reply are the same face at the same size.
 *
 * - `prose`: what the model and the reader wrote.
 * - `mono`: code, paths, commands, diff rows.
 * - `meta`: everything that describes content rather than being it -- tool
 *   titles, captions, timestamps, notices, chip text.
 * - `micro`: the one size smaller, for counters and state chips that sit
 *   beside meta text and must not compete with it.
 */
export const AGENT_TYPE = {
  prose: { size: 14, lineHeight: 21 },
  mono: { size: 12.5, lineHeight: 18 },
  meta: { size: 12, lineHeight: 16 },
  micro: { size: 11, lineHeight: 14 },
} as const;
