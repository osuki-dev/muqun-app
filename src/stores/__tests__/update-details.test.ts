import { afterEach, expect, test } from 'bun:test';
import {
  closeUpdateDetails,
  openBundledReleaseNotes,
  openUpdateDetails,
  useUpdateDetails,
} from '../update-details';

afterEach(closeUpdateDetails);

test('notes stay closed until explicitly opened with actual content', () => {
  openUpdateDetails(undefined);
  openUpdateDetails('  ');
  expect(useUpdateDetails.getState()).toEqual({ notes: null, bundled: false, phase: null });
  openUpdateDetails('Actual server notes');
  expect(useUpdateDetails.getState()).toEqual({
    notes: 'Actual server notes',
    bundled: false,
    phase: null,
  });
  closeUpdateDetails();
  expect(useUpdateDetails.getState()).toEqual({ notes: null, bundled: false, phase: null });
});

test('bundled release notes are a distinct explicit selection, never an OTA fallback', () => {
  openUpdateDetails('Server message');
  openBundledReleaseNotes();
  expect(useUpdateDetails.getState()).toEqual({ notes: null, bundled: true, phase: null });
  openUpdateDetails('New server message');
  expect(useUpdateDetails.getState()).toEqual({
    notes: 'New server message',
    bundled: false,
    phase: null,
  });
});

test('the notes snapshot preserves next-launch status rather than claiming installation', () => {
  openUpdateDetails('Pending release', 'ready');
  expect(useUpdateDetails.getState()).toEqual({
    notes: 'Pending release',
    bundled: false,
    phase: 'ready',
  });
  closeUpdateDetails();
  expect(useUpdateDetails.getState().phase).toBeNull();
});
