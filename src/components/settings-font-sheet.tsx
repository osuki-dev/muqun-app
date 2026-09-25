/**
 * The reader's own fonts: what each slot is set to, and the three ways to
 * change it.
 *
 * Muqun offers no fonts. There is no list to scroll, no bundled family to pick
 * from, no licensing to agree to -- the app has nothing to recommend and has
 * not earned an opinion about what somebody should read in. What it has is two
 * slots and a way to put a file in them, which is the whole feature: a reader
 * with a custom need (a Han face that holds up at 14pt, a mono face with a
 * slashed zero, a face their dyslexia gets on with) brings the file, and the
 * app's job is to check it will not break anything and then get out of the way.
 *
 * So the sheet does not police taste. It refuses a file that is not a font,
 * says so in a sentence, and warns -- quietly, once, under the row -- when a
 * face in the monospace slot has uneven advances. It does not refuse it. A
 * reader who wants their proportional favourite in the terminal has been told
 * what will happen and is entitled to it.
 *
 * Two groups rather than one list, because the slots answer different
 * questions and a reader almost always means one of them. Interface first: it
 * is the larger change -- every screen in the app -- and Monospace is the
 * narrower one under it.
 *
 * At most one URL field is open at a time. That is a layout rule with a reason:
 * the sheet system allows one primary action, and two open fields would put two
 * Download buttons on one ground.
 */
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SheetScene,
  SheetSceneAction,
  SheetSceneField,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneQuietAction,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { useMonoFontFamily, useUserFontStatus } from '@/hooks/use-user-fonts';
import { formatAssetSize } from '@/lib/asset-display';
import { feedback } from '@/lib/feedback';
import { DURATION, fadeIn, fadeOut } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { useReskinTransition } from '@/components/reskin-transition';
import { useAppSettings } from '@/stores/app-settings';
import {
  advanceFontInstall,
  fontInstallBar,
  fontInstallCancellable,
  fontInstallPercent,
  type FontInstallEvent,
  type FontInstallState,
} from '@/theme/font-install-phase';
import {
  downloadUserFont,
  importUserFont,
  isDownloadableFontUrl,
  loadUserFont,
  removeUserFontFile,
  SYSTEM_FONT_SLOT,
  UserFontError,
  userFontSource,
  USER_FONT_MAX_BYTES,
  type FontSlot,
  type FontSlotId,
  type UserFontProblem,
} from '@/theme/user-fonts';
import { FontedTextInput } from '@/components/fonted-text-input';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

/** The focused field's clearance above the keyboard: the URL field. */
const KEYBOARD_BOTTOM_OFFSET = 96;

/** Which setting each slot is stored under. */
const SLOT_SETTING = { interface: 'interfaceFont', mono: 'monoFont' } as const;

/**
 * How long the finished bar stays on screen before the row goes quiet.
 *
 * The fill animates on `short`, so anything less than that and the reader
 * watches a bar begin to fill and then vanish -- which is what a *failed*
 * install looks like. This is the fill plus a beat to see it full: the one
 * moment in the whole sequence that says the waiting is over and it worked.
 */
const DONE_HOLD_MS = DURATION.short + DURATION.long;

export function SettingsFontSheet({ onClose }: { onClose: () => void }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  useRenderTally('SettingsFontSheet');
  const reskin = useReskinTransition();

  const interfaceFont = useAppSettings((state) => state.interfaceFont);
  const monoFont = useAppSettings((state) => state.monoFont);

  /** Which group has its URL field open, if any. At most one. */
  const [urlSlot, setUrlSlot] = useState<FontSlotId | null>(null);
  const [url, setUrl] = useState('');
  /**
   * What each slot is doing, phase by phase. `null` is "nothing".
   *
   * The sequence itself is `theme/font-install-phase.ts`, which is where the
   * rule that it never runs backwards lives: three different things push
   * events at this -- the native download's progress callback, the checks
   * inside `user-fonts.ts`, and the registration below -- and any of them can
   * arrive late.
   */
  const [work, setWork] = useState<Record<FontSlotId, FontInstallState | null>>({
    interface: null,
    mono: null,
  });
  const [errors, setErrors] = useState<Partial<Record<FontSlotId, UserFontProblem>>>({});
  /**
   * The live download, so leaving the sheet stops it.
   *
   * A reader who swipes a sheet away has cancelled what was on it. Without
   * this the fetch would run to completion against a screen nobody is looking
   * at, and land a font the reader had already changed their mind about.
   */
  const abortRef = useRef<Partial<Record<FontSlotId, AbortController>>>({});
  /** The timers holding a finished bar on screen; see `DONE_HOLD_MS`. */
  const settleRef = useRef<Partial<Record<FontSlotId, ReturnType<typeof setTimeout>>>>({});
  useEffect(() => {
    const timers = settleRef.current;
    const controllers = abortRef.current;
    return () => {
      for (const controller of Object.values(controllers)) controller?.abort();
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  /** What launch registration could not do, until the reader fixes it. */
  const launchProblems = useUserFontStatus((state) => state.problems);

  const slots: Record<FontSlotId, FontSlot> = { interface: interfaceFont, mono: monoFont };

  /**
   * One step of one slot's install.
   *
   * The reducer returns the state it was given when an event changes nothing,
   * and that identity is passed straight on: a native progress callback fires
   * far more often than the bar has anything new to say, and re-rendering the
   * whole sheet for a repeated byte count is how a download makes a phone warm.
   */
  function emit(id: FontSlotId, event: FontInstallEvent) {
    setWork((current) => {
      const next = advanceFontInstall(current[id], event);
      return next === current[id] ? current : { ...current, [id]: next };
    });
  }

  /** Hold the filled bar for a beat, then let the row go quiet. */
  function holdDone(id: FontSlotId) {
    clearTimeout(settleRef.current[id]);
    settleRef.current[id] = setTimeout(() => emit(id, { kind: 'settled' }), DONE_HOLD_MS);
  }

  function setSlotError(id: FontSlotId, problem: UserFontProblem | undefined) {
    setErrors((current) => ({ ...current, [id]: problem }));
  }

  /**
   * Store the new slot, bind the alias, and throw nothing away until both are
   * done.
   *
   * The alias is rebound here rather than left to the next launch, because a
   * reader who has just installed a font is looking straight at the app and
   * "restart to see it" is not an answer. Every surface follows at once; see
   * `slotFontFamily` for why a per-file family name is what makes that true.
   */
  async function apply(id: FontSlotId, slot: FontSlot) {
    await loadUserFont(id, slot);
    // The face is already registered by here, so the only thing left to happen
    // is every text node in the app re-measuring at once. That is what the
    // halftone is covering.
    await reskin.run({
      kind: 'font',
      apply: () => useAppSettings.getState().update({ [SLOT_SETTING[id]]: slot }),
    });
    setSlotError(id, undefined);
  }

  async function download(id: FontSlotId) {
    const trimmed = url.trim();
    if (!isDownloadableFontUrl(trimmed)) {
      setSlotError(id, { kind: 'download' });
      return;
    }
    await feedback('selection');
    const controller = new AbortController();
    abortRef.current[id] = controller;
    setSlotError(id, undefined);
    emit(id, { kind: 'start', mode: 'download' });
    return settleAfter(
      async () => {
        try {
          const installed = await downloadUserFont({
            slot: id,
            url: trimmed,
            previous: slots[id],
            signal: controller.signal,
            onProgress: ({ bytesWritten, totalBytes }) =>
              emit(id, { kind: 'bytes', bytesWritten, totalBytes }),
            onStep: (phase) => emit(id, { kind: 'step', phase }),
          });
          // The last step, and the one `user-fonts.ts` cannot report because it
          // happens here: binding the face to its alias is what actually changes
          // what the app draws with.
          emit(id, { kind: 'step', phase: 'registering' });
          await apply(id, installed);
          emit(id, { kind: 'done' });
          holdDone(id);
          setUrl('');
          setUrlSlot(null);
        } catch (error) {
          emit(id, { kind: reportFailure(id, error) ? 'cancelled' : 'failed' });
        }
      },
      () => {
        // Only if it is still ours. The other slot can start its own download
        // while this one runs, and clearing the map wholesale would orphan that
        // controller -- its Cancel would do nothing, and leaving the sheet would
        // no longer stop it.
        if (abortRef.current[id] === controller) delete abortRef.current[id];
      }
    );
  }

  /**
   * Stop the transfer, and say nothing.
   *
   * The row is cleared by the rejection finding its way back through
   * `download`, not from here: a row that said "Cancelled" while bytes were
   * still landing would be the app reporting something it had asked for
   * rather than something that had happened.
   */
  function cancel(id: FontSlotId) {
    void feedback('selection');
    // Per slot, because `busy` is per group: a download running in Interface
    // does not disable Monospace's own rows, so both slots can be fetching at
    // once and one Cancel must stop the row it was pressed on.
    abortRef.current[id]?.abort();
  }

  async function importFile(id: FontSlotId) {
    await feedback('selection');
    setSlotError(id, undefined);
    emit(id, { kind: 'start', mode: 'import' });
    try {
      const installed = await importUserFont({
        slot: id,
        previous: slots[id],
        onStep: (phase) => emit(id, { kind: 'step', phase }),
      });
      // `null` is the reader closing the picker, which is not a failure and
      // must not be drawn as one.
      if (!installed) {
        emit(id, { kind: 'cancelled' });
        return;
      }
      emit(id, { kind: 'step', phase: 'registering' });
      await apply(id, installed);
      emit(id, { kind: 'done' });
      holdDone(id);
    } catch (error) {
      emit(id, { kind: reportFailure(id, error) ? 'cancelled' : 'failed' });
    }
  }

  /** Draws the failure, and answers whether it was the reader's own doing. */
  function reportFailure(id: FontSlotId, error: unknown): boolean {
    const problem =
      error instanceof UserFontError ? error.problem : ({ kind: 'storage' } as UserFontProblem);
    // A cancel is the reader's own decision arriving back as an exception.
    // Saying "could not download" to somebody who pressed the back arrow is
    // the app arguing with them.
    const cancelled = problem.kind === 'cancelled';
    setSlotError(id, cancelled ? undefined : problem);
    return cancelled;
  }

  async function clearSlot(id: FontSlotId) {
    await feedback('selection');
    const previous = slots[id];
    await reskin.run({
      kind: 'font',
      apply: () => useAppSettings.getState().update({ [SLOT_SETTING[id]]: SYSTEM_FONT_SLOT }),
    });
    // The setting first, the file after: a slot that is already back on the
    // system font cannot be left pointing at bytes that have gone.
    removeUserFontFile(previous);
    setSlotError(id, undefined);
  }

  function openUrlField(id: FontSlotId) {
    setUrl('');
    setSlotError(id, undefined);
    setUrlSlot((current) => (current === id ? null : id));
  }

  return (
    <SheetScene
      testID="settings-font-sheet"
      title={t`Font`}
      caption={t`Muqun has no fonts of its own. Add one and it is kept on this device.`}>
      {/*
        Keyboard-aware because a URL is typed into this scroller, and
        `SheetSceneFooter` adds the keyboard's own height at the end so the
        group below the open field stays reachable while it is up.
      */}
      <KeyboardAwareScrollView
        nestedScrollEnabled
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}>
        <FontSlotGroup
          id="interface"
          first
          heading={t`Interface`}
          description={t`Every screen in the app.`}
          slot={interfaceFont}
          work={work.interface}
          problem={errors.interface ?? launchProblems.interface}
          urlOpen={urlSlot === 'interface'}
          url={url}
          onUrlChange={setUrl}
          onOpenUrl={() => openUrlField('interface')}
          onDownload={() => void download('interface')}
          onCancel={() => cancel('interface')}
          onImport={() => void importFile('interface')}
          onUseSystem={() => void clearSlot('interface')}
        />
        <SheetSceneGroupRule />
        <FontSlotGroup
          id="mono"
          heading={t`Monospace`}
          description={t`The terminal, and code in a reply.`}
          slot={monoFont}
          work={work.mono}
          problem={errors.mono ?? launchProblems.mono}
          urlOpen={urlSlot === 'mono'}
          url={url}
          onUrlChange={setUrl}
          onOpenUrl={() => openUrlField('mono')}
          onDownload={() => void download('mono')}
          onCancel={() => cancel('mono')}
          onImport={() => void importFile('mono')}
          onUseSystem={() => void clearSlot('mono')}
        />
        <SheetSceneFooter bottomInset={insets.bottom} />
      </KeyboardAwareScrollView>
    </SheetScene>
  );
}

/** One slot: what it is set to now, and the three ways to change it. */
function FontSlotGroup({
  id,
  first,
  heading,
  description,
  slot,
  work,
  problem,
  urlOpen,
  url,
  onUrlChange,
  onOpenUrl,
  onDownload,
  onCancel,
  onImport,
  onUseSystem,
}: {
  id: FontSlotId;
  first?: boolean;
  heading: string;
  description: string;
  slot: FontSlot;
  work: FontInstallState | null;
  problem: UserFontProblem | undefined;
  urlOpen: boolean;
  url: string;
  onUrlChange: (next: string) => void;
  onOpenUrl: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onImport: () => void;
  onUseSystem: () => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const inputStyle = useSheetSceneInputStyle();
  const monoFontFamily = useMonoFontFamily();
  const busy = work !== null;
  const installed = slot.kind === 'file' ? slot : null;
  const bar = work ? fontInstallBar(work) : null;

  /**
   * The step, as one word the reader can watch change.
   *
   * Each of them is a real wait: a request with no answer, bytes arriving, the
   * file being read and parsed, the face being registered. None is a timer
   * pretending to be work -- the sequence comes from `user-fonts.ts` doing the
   * thing it names.
   *
   * Declared inside the component for the same reason `problemSentence` is:
   * the Lingui macro transforms `t` where `useLingui()` lexically binds it.
   */
  function phaseLabel(state: FontInstallState): string {
    switch (state.phase) {
      case 'connecting':
        return t`Connecting…`;
      case 'downloading':
        return t`Downloading`;
      case 'copying':
        return t`Copying…`;
      case 'checking':
        return t`Checking…`;
      case 'registering':
        return t`Installing…`;
      case 'done':
        return t`Installed`;
    }
  }

  /**
   * The number beside the step, and only while bytes are actually moving.
   *
   * A percentage where the server said how big the file is, and the running
   * total where it did not -- "1.2 MB" is not a fraction, but it is evidence,
   * and it is the only evidence an unmeasured transfer can produce. Nothing at
   * all for the local steps: there is no honest number for them, and the app
   * does not invent one.
   */
  function phaseMeasure(state: FontInstallState): string {
    if (state.phase !== 'downloading') return '';
    const percent = fontInstallPercent(state);
    return percent === null ? formatAssetSize(state.receivedBytes) : `${percent}%`;
  }

  /**
   * The quiet note under a monospace face whose glyphs are not all one width.
   *
   * A note and not a refusal. It is measured at install time from `i M W 0`,
   * so it is a fact rather than a guess, and what it predicts is real: the grid
   * places every glyph on a fixed cell advance, so a proportional face draws
   * with visible gaps and overlaps. But the reader picked it, and a terminal
   * that refuses the font somebody chose for it is an app that has decided it
   * knows better.
   */
  const notMonospace = id === 'mono' && installed?.isMonospace === false;

  /**
   * Why a file was not installed, as one sentence the reader can act on.
   *
   * Sentence case, and no vocabulary the app invented. The three that name a
   * format are separate from the general one on purpose: "this is a web font"
   * tells somebody to go and re-export it, and "this file is not a font" tells
   * them nothing they did not already suspect. The download status is in the
   * sentence for the same reason -- 404 is a link that is wrong and 403 is a
   * link that needs a login, and those are different afternoons.
   *
   * Declared here rather than at module scope because the Lingui macro
   * transforms `t` where `useLingui()` lexically binds it; a `t` passed in as an
   * argument extracts no messages and ships the English source to every reader.
   */
  function problemSentence(problem: UserFontProblem): string {
    switch (problem.kind) {
      case 'format':
        if (problem.format === 'woff' || problem.format === 'woff2') {
          return t`This is a web font. Muqun needs a .ttf or .otf file.`;
        }
        if (problem.format === 'collection') {
          return t`This is a font collection. Muqun needs a single font file.`;
        }
        if (problem.format === 'webpage') {
          return t`That link opens a web page, not the font file. Use the file's direct download link.`;
        }
        return t`This file is not a TrueType or OpenType font.`;
      case 'too-large':
        return t`This file is too large.`;
      case 'empty':
        return t`This file is empty.`;
      case 'unreadable':
        return t`This font could not be read.`;
      case 'download':
        return problem.status === undefined
          ? t`Could not download. Check the link and your connection.`
          : // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
            t`Could not download: ${problem.status}`;
      case 'storage':
        return t`The font file is missing. Add it again.`;
      case 'cancelled':
        return '';
    }
  }

  return (
    <View>
      <SheetSceneGroupHeading title={heading} first={first} testID={`font-group-${id}`} />
      <SheetSceneRow
        title={installed ? installed.label : t`System font`}
        /*
         * The title is what the face calls itself and the caption is where it
         * came from, which is the order a reader asks the two questions in.
         *
         * The caption used to be `installed.source` raw, which is the string
         * the app stores to recognise a re-paste of the same URL -- a whole
         * CDN path with a cache key on the end, or on Android a Storage Access
         * Framework document URI. Neither is a place. `userFontSource` reduces
         * a URL to its host and a picked file to its own name, and answers
         * `null` for an opaque handle, where the honest caption is the sentence
         * about the slot rather than a document id dressed up as provenance.
         */
        caption={installed ? (userFontSource(installed.source) ?? description) : description}
        captionKind={installed && userFontSource(installed.source) ? 'path' : 'text'}
        selected
        // The slot is the label and whatever is in it is the value, which is
        // the one arrangement that reads correctly in every state: "Interface,
        // SerifInterface", "Monospace, System font", "Monospace, Downloading".
        //
        // The value is always present and never `undefined`, because Android
        // does not clear an accessibility value that is set and then removed --
        // the view keeps the last description it was given, so a row that had
        // finished downloading went on announcing "Downloading" for the rest of
        // the session. Found on device.
        accessibilityLabel={heading}
        // The phase and not the percentage. A value that changed sixty times a
        // second would be a row talking over itself; the step names are five
        // announcements across a whole install, and the bar below carries the
        // fraction for a reader who goes looking for it.
        accessibilityValue={{
          text: work ? phaseLabel(work) : installed ? installed.label : t`System font`,
        }}
        busy={busy}
        // The title changes under the reader exactly once per install, and it
        // is the thing they were waiting for: the new name fades in where
        // "System font" was rather than replacing it between two frames.
        crossfadeTitle
        // And the rule takes a breath at the same moment, so the hand-off from
        // "a bar was moving here" to "this row is the font now" is one beat
        // and not two unrelated changes. Keyed on the file, so it fires on an
        // install and on a return to the system font, and never on open.
        confirmKey={installed ? installed.file : 'system'}
        testID={`font-current-${id}`}
        selectedTestID={`font-current-${id}-selected`}
        meta={
          work ? (
            <View style={styles.meta}>
              {/* The live region is the words only. A percentage ticking
                  inside it would make Android read the row aloud on every
                  frame, so the number is drawn and explicitly not announced. */}
              <View accessibilityLiveRegion="polite">
                {/* Keyed on the phase and not on the whole string, so the
                    cross-fade runs when the step changes and not when the
                    count does. The same beat as the reasoning block's label. */}
                {/* No exit: an exiting view leaves the layout while it fades, and
                    a failed download laid this label across the error. */}
                <Animated.View key={work.phase} entering={fadeIn('short')}>
                  <Text variant="caption" color={colors.textMuted} testID={`font-phase-${id}`}>
                    {phaseLabel(work)}
                  </Text>
                </Animated.View>
              </View>
              {phaseMeasure(work) ? (
                <Text
                  variant="caption"
                  color={colors.textSubtle}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                  // Tabular, so a percentage does not reflow the row as it
                  // counts up.
                  style={styles.measure}
                  testID={`font-measure-${id}`}>
                  {phaseMeasure(work)}
                </Text>
              ) : null}
            </View>
          ) : undefined
        }
        trailing={
          <View style={styles.underRow}>
            {work && bar ? (
              <ThemeImportProgress
                compact
                label={phaseLabel(work)}
                // One key for the whole install, so the fill travels from
                // where the transfer left it to full rather than being reborn
                // at nought when the phase changes. The switch between the
                // travelling segment and the fill is a change of component,
                // which fades of its own accord.
                phase={`font-${id}`}
                indeterminate={bar.mode === 'indeterminate'}
                completed={bar.mode === 'determinate' ? bar.completed : undefined}
                total={bar.mode === 'determinate' ? bar.total : undefined}
                testID={`font-progress-${id}`}
              />
            ) : null}
            {work && fontInstallCancellable(work) ? (
              <Animated.View entering={fadeIn('short')}>
                <SheetSceneQuietAction
                  label={t`Cancel`}
                  onPress={onCancel}
                  testID={`font-cancel-${id}`}
                />
              </Animated.View>
            ) : null}
            {problem ? (
              <Animated.View entering={fadeIn('short')}>
                <Text
                  variant="caption"
                  color={colors.danger}
                  accessibilityRole="alert"
                  testID={`font-error-${id}`}>
                  {problemSentence(problem)}
                </Text>
              </Animated.View>
            ) : null}
            {notMonospace ? (
              <Animated.View entering={fadeIn('short')}>
                <Text variant="caption" color={colors.textMuted} testID={`font-uneven-${id}`}>
                  {t`Not monospace — the terminal may look uneven`}
                </Text>
              </Animated.View>
            ) : null}
          </View>
        }
      />

      <SheetSceneRow
        title={t`Paste a URL…`}
        disabled={busy}
        onPress={onOpenUrl}
        testID={`font-paste-${id}`}
      />
      {urlOpen ? (
        // Keyed on the slot so opening the other group's field is a new node
        // rather than the same one sliding between two headings.
        <Animated.View key={id} entering={fadeIn('short')} exiting={fadeOut('micro')}>
          <SheetSceneField
            label={t`Font file address`}
            hint={t`A direct link to a .ttf or .otf file.`}>
            <FontedTextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardType="url"
              inputMode="url"
              onChangeText={onUrlChange}
              onSubmitEditing={onDownload}
              placeholder="https://"
              placeholderTextColor={colors.textMuted}
              returnKeyType="go"
              /*
               * A URL, so the monospace slot, layered over the sheet's own
               * field style rather than replacing it.
               *
               * The rule the app now holds to: a sentence follows the
               * interface face, a literal the reader types or checks
               * character by character follows the mono one. This field is
               * the second kind twice over -- it is read back against a link
               * the reader copied from somewhere else, and one wrong
               * character in a raw host is a download that fails for a reason
               * nobody can see. The sheet's shared style supplies the size
               * and the interface family; this names the family only.
               */
              style={[inputStyle, { fontFamily: monoFontFamily }]}
              testID={`font-url-${id}`}
              value={url}
            />
          </SheetSceneField>
          <SheetSceneAction
            label={t`Download`}
            busy={work?.kind === 'download'}
            disabled={!isDownloadableFontUrl(url)}
            onPress={onDownload}
            testID={`font-download-${id}`}
          />
        </Animated.View>
      ) : null}

      <SheetSceneRow
        title={t`Import a file…`}
        caption={
          // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
          t`A .ttf or .otf up to ${Math.round(USER_FONT_MAX_BYTES / (1024 * 1024))} MB.`
        }
        disabled={busy}
        onPress={onImport}
        testID={`font-import-${id}`}
      />
      {/*
        Always here, and not only when a font is installed. It is the way back,
        and a row that appears and disappears is a control the reader has to
        find twice; disabled while the slot is already on the system font says
        the same thing without moving anything.
      */}
      <SheetSceneRow
        title={t`Use system font`}
        disabled={busy || !installed}
        disabledCaption={installed ? undefined : t`Already on`}
        onPress={onUseSystem}
        testID={`font-system-${id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /** The progress bar, the Cancel, the error and the note, under the row. */
  underRow: { gap: SHEET_LADDER.tight, paddingBottom: SHEET_LADDER.tight },
  /** The step and its number, at the end of the row: one line, never wrapped. */
  meta: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.tight },
  /** A count that must not reflow the row as it changes. */
  measure: { fontVariant: ['tabular-nums'] },
});
