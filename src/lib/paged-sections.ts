/**
 * The first `limit` rows of a sectioned list, sections intact.
 *
 * A host can publish hundreds of models -- every provider it has ever been
 * signed in to, each with its whole catalogue -- and a sheet that mounts a row
 * for every one of them pays for all of them before it shows the first. The
 * list is cut here, by row count across sections, and the sheet asks for more
 * as the reader nears the end of what is drawn.
 *
 * Sections keep their order and their titles. One that is cut part-way keeps
 * its heading, because the rows under it are still that provider's; one that
 * has no rows inside the limit is not drawn at all, so a heading never stands
 * over nothing.
 *
 * The same array comes back when nothing is cut, so a memo downstream does not
 * see a new list on every render of a short one.
 */
export const SECTION_PAGE_SIZE = 40;

/** How close to the end of the drawn rows the reader gets before more load, in points. */
export const SECTION_PAGE_THRESHOLD = 600;

export type PagedSection<Row> = { title: string; models: readonly Row[] };

export function pageSections<Row, Section extends PagedSection<Row>>(
  sections: readonly Section[],
  limit: number
): { sections: readonly Section[]; shown: number; total: number } {
  const total = sections.reduce((sum, section) => sum + section.models.length, 0);
  const budget = Math.max(0, Math.floor(limit));
  if (total <= budget) return { sections, shown: total, total };

  const result: Section[] = [];
  let left = budget;
  for (const section of sections) {
    if (left <= 0) break;
    if (section.models.length <= left) {
      result.push(section);
      left -= section.models.length;
    } else {
      result.push({ ...section, models: section.models.slice(0, left) });
      left = 0;
    }
  }
  return { sections: result, shown: budget, total };
}

/** Whether a scroll position is near enough to the end to ask for the next page. */
export function nearListEnd(
  metrics: { offset: number; viewport: number; content: number },
  threshold: number = SECTION_PAGE_THRESHOLD
): boolean {
  return metrics.offset + metrics.viewport >= metrics.content - threshold;
}
