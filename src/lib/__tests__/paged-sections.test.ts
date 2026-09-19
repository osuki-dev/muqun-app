import { describe, expect, test } from 'bun:test';

import { nearListEnd, pageSections } from '../paged-sections';

const sections = [
  { title: 'A', models: ['a1', 'a2', 'a3'] },
  { title: 'B', models: ['b1', 'b2'] },
  { title: 'C', models: ['c1'] },
];

describe('pageSections', () => {
  test('a list inside the limit comes back as the same array', () => {
    const paged = pageSections(sections, 10);
    expect(paged.sections).toBe(sections);
    expect(paged).toMatchObject({ shown: 6, total: 6 });
  });

  test('the cut falls by row count across sections, and a cut section keeps its heading', () => {
    const paged = pageSections(sections, 4);
    expect(paged.sections).toEqual([
      { title: 'A', models: ['a1', 'a2', 'a3'] },
      { title: 'B', models: ['b1'] },
    ]);
    expect(paged).toMatchObject({ shown: 4, total: 6 });
  });

  test('a section with no rows inside the limit is not drawn: no heading over nothing', () => {
    expect(pageSections(sections, 3).sections.map((section) => section.title)).toEqual(['A']);
    expect(pageSections(sections, 0).sections).toEqual([]);
  });
});

describe('nearListEnd', () => {
  test('asks for more only inside the threshold', () => {
    expect(nearListEnd({ offset: 0, viewport: 800, content: 4000 }, 600)).toBe(false);
    expect(nearListEnd({ offset: 2700, viewport: 800, content: 4000 }, 600)).toBe(true);
  });
});
