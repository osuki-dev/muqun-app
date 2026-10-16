import { expect, test } from 'bun:test';

import { fontVariationAxes, parseFontSlot } from '../user-font-file';

type Axis = { tag: string; min: number; default: number; max: number; hidden?: boolean };

/** A TrueType file with one table: the `fvar` described by `axes`. */
function sfntWithFvar(axes: Axis[], axisSize = 20): Uint8Array {
  const fvarBytes = 16 + axes.length * axisSize;
  const offset = 12 + 16;
  const bytes = new Uint8Array(offset + fvarBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  bytes.set(
    [...'fvar'].map((c) => c.charCodeAt(0)),
    12
  );
  view.setUint32(12 + 8, offset);
  view.setUint32(12 + 12, fvarBytes);

  view.setUint16(offset, 1);
  view.setUint16(offset + 4, 16);
  view.setUint16(offset + 6, 2);
  view.setUint16(offset + 8, axes.length);
  view.setUint16(offset + 10, axisSize);
  axes.forEach((axis, index) => {
    const at = offset + 16 + index * axisSize;
    bytes.set(
      [...axis.tag].map((c) => c.charCodeAt(0)),
      at
    );
    view.setInt32(at + 4, Math.round(axis.min * 0x10000));
    view.setInt32(at + 8, Math.round(axis.default * 0x10000));
    view.setInt32(at + 12, Math.round(axis.max * 0x10000));
    view.setUint16(at + 16, axis.hidden ? 1 : 0);
  });
  return bytes;
}

test('reads visible axes with signed 16.16 ranges and honours a grown record size', () => {
  const bytes = sfntWithFvar(
    [
      { tag: 'wght', min: 100, default: 400, max: 900 },
      { tag: 'slnt', min: -10, default: 0, max: 0 },
      { tag: 'opsz', min: 8, default: 14, max: 144, hidden: true },
      { tag: 'wdth', min: 75, default: 100, max: 112.5 },
    ],
    24
  );
  expect(fontVariationAxes(bytes)).toEqual([
    { tag: 'wght', min: 100, default: 400, max: 900 },
    { tag: 'slnt', min: -10, default: 0, max: 0 },
    { tag: 'wdth', min: 75, default: 100, max: 112.5 },
  ]);
});

test('a static face, a truncated table and an unordered range yield no axes', () => {
  const variable = sfntWithFvar([{ tag: 'wght', min: 100, default: 400, max: 900 }]);
  const staticFace = variable.slice(0, 12);
  new DataView(staticFace.buffer).setUint16(4, 0);
  expect(fontVariationAxes(staticFace)).toEqual([]);
  expect(fontVariationAxes(variable.slice(0, variable.length - 4))).toEqual([]);
  expect(
    fontVariationAxes(sfntWithFvar([{ tag: 'wght', min: 900, default: 400, max: 100 }]))
  ).toEqual([]);
});

test('stored axes are kept only when every axis is well formed', () => {
  const slot = { kind: 'file', source: 'a.ttf', file: 'fonts/interface-abc.ttf', label: 'A' };
  const wght = { tag: 'wght', min: 100, default: 400, max: 900 };
  expect(parseFontSlot({ ...slot, axes: [wght] })).toEqual({ ...slot, kind: 'file', axes: [wght] });
  expect(parseFontSlot({ ...slot, axes: [] })).toEqual({ ...slot, kind: 'file', axes: [] });
  expect(parseFontSlot({ ...slot, axes: [{ ...wght, tag: 'wg' }] })).toEqual({
    ...slot,
    kind: 'file',
  });
  expect(parseFontSlot(slot)).toEqual({ ...slot, kind: 'file' });
});
