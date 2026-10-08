import * as Clipboard from 'expo-clipboard';
import { Trans, useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Button } from '@/components/themed-button';
import { Skeleton } from '@/components/themed-skeleton';
import { Check, Copy, X } from 'lucide-react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMarkdownFonts } from '@/hooks/use-user-fonts';
import { createMarkdownStyle, markdownImageStyle } from '@/lib/markdown-style';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { AudioAssetPreview } from '@/components/audio-asset-preview';
import { SheetFrame } from '@/components/sheet-ground';
import { PressableScale } from '@/components/pressable-scale';
import { formatAssetSize } from '@/lib/asset-display';
import { fenceLanguageForFile, fencedFile } from '@/lib/code-language';
import { useLatestRef } from '@/hooks/use-render-refs';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { fadeIn, fadeOut } from '@/lib/motion';
import {
  assetImageSource,
  readAssetImageSource,
  readAssetText,
  type AssetImageSource,
  type SessionAsset,
  readAssetBytes,
} from '@/lib/gateway-client';
import { CodeLinesView } from '@/components/code-lines-view';
import { MarkdownDocumentView } from '@/components/markdown-document-view';
import { MAX_ASSET_TEXT_BYTES, indexTextLines } from '@/lib/text-preview';
import { assetPresentation, type AssetPresentation } from '@/lib/asset-viewer-layout';
import { describeGatewayFailure } from '@/lib/network-error';
import { isSafeExternalLink } from '@/lib/safe-link';
import { CustomThemeLibrary, type ThemePrimaryAction } from '@/components/custom-theme-library';
import { SHEET_LADDER, SheetSceneAction, SheetSceneHeading } from '@/components/sheet-scene';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { prepareThemeAssets, type PreparedThemeAssets } from '@/theme/assets';
import { ThemeImportRequest } from '@/theme/import-request';
import { unpackTheme } from '@/theme/package';
import { THEME_LIMITS } from '@/theme/schema';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import { themeFromDocument } from '@/theme/file-preview';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import {
  escapeMarkdownText,
  messageImageResolver,
  rewriteMessageImages,
} from '@/lib/message-images';

/**
 * A document's images that name a path on the gateway host. The phone cannot
 * load those, so each says so in words rather than drawing an empty box.
 *
 * TODO: resolve a relative image against the document's own directory. The
 * content route only serves ids the gateway has indexed or listed, and the
 * exact-path lookup that would list a sibling is scoped to a terminal tab,
 * which a file opened from an agent session does not have.
 */
const NO_IMAGE_URIS: ReadonlyMap<string, string> = new Map();
const NO_PENDING_IMAGES: ReadonlySet<string> = new Set();
const documentImageResolver = messageImageResolver(NO_IMAGE_URIS, NO_PENDING_IMAGES);

/**
 * Read-only view of one artifact the agent produced.
 *
 * Images use the image library's authenticated fetch and decode. Text is read
 * through the bounded text reader. Audio is downloaded through the same
 * authenticated transport into an owned temporary file, with a 10 MiB ceiling,
 * so the native player can seek without exposing Gateway credentials to it.
 */
export function AssetViewer({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
  // A picture goes to the lightbox and its black matte; everything else is
  // text or a description of a file, on the frosted ground below. See
  // `asset-viewer-layout.ts`.
  if (assetPresentation(asset) === 'lightbox') {
    const source = assetImageSource(asset);
    if (!source) return <EncryptedImageViewer asset={asset} onClose={onClose} />;
    return (
      <ImagePreviewModal
        images={[
          {
            id: asset.id,
            uri: source.uri,
            headers: source.headers,
            cacheKey: source.cacheKey,
          },
        ]}
        initialIndex={0}
        onClose={onClose}
      />
    );
  }

  return <AssetSheet asset={asset} onClose={onClose} />;
}

function EncryptedImageViewer({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<AssetImageSource | null>(null);
  // A mailbox, not a dependency. The caller hands `onClose` down as an inline
  // arrow, so its identity changes on every parent render -- and the terminal
  // workspace re-renders for every streamed frame. With the callback in the
  // effect's dependency list, an agent printing meant the read below was torn
  // down and restarted a few times a second: `source` never landed, and the
  // viewer sat on its loading state for as long as the output kept coming.
  const onCloseRef = useLatestRef(onClose);
  useEffect(() => {
    let active = true;
    // The same bargain the text read below makes, and for the same reason: a
    // picture is downloaded whole before the lightbox has anything to show, so
    // closing the viewer while it is coming has to stop the download rather
    // than let it finish into a screen that has gone.
    const controller = new AbortController();
    readAssetImageSource(asset, { signal: controller.signal })
      .then((next) => {
        if (active) setSource(next);
      })
      .catch(() => {
        if (active) onCloseRef.current();
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [asset, onCloseRef]);
  if (!source) {
    // The bytes have to arrive before the lightbox has anything to show, and
    // the wait is spent as the same black surface the lightbox opens on -- with
    // the way out already in place. An invisible placeholder here was a trap:
    // a viewer that is open but shows nothing has nothing to press.
    return (
      <Modal
        visible
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={onClose}>
        <View style={styles.encryptedLoading}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <PressableScale
            accessibilityLabel={t`Close preview`}
            onPress={onClose}
            style={[styles.encryptedLoadingClose, { top: insets.top + 10 }]}>
            <X size={20} color="#FFFFFF" />
          </PressableScale>
        </View>
      </Modal>
    );
  }
  return (
    <ImagePreviewModal
      images={[{ id: asset.id, uri: source.uri, cacheKey: source.cacheKey }]}
      initialIndex={0}
      onClose={onClose}
    />
  );
}

/** How long the header's copy button stays a tick before it is a copy icon again. */
const COPIED_FEEDBACK_MS = 1_600;

/** Everything that is not an image: a document, some text, or a file we can only describe. */
function AssetSheet({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
  const surfaceBackground = useSurfaceBackground();
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();
  const relativeTime = useRelativeTime();

  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const markdownFonts = useMarkdownFonts();
  const { height: viewportHeight } = useWindowDimensions();
  const markdownStyle = useMemo(() => {
    const base = createMarkdownStyle(theme.colors, markdownFonts);
    return {
      ...base,
      image: markdownImageStyle(viewportHeight, base.codeBlock?.borderRadius ?? 0),
    };
  }, [theme.colors, markdownFonts, viewportHeight]);
  const [content, setContent] = useState<string | null>(null);
  /**
   * Which body this file gets. `too-large` is the one ceiling left, and it is
   * about the phone rather than the renderer: `asset.size` is a real file size
   * in real bytes, and above `MAX_ASSET_TEXT_BYTES` the file is not asked for
   * at all -- refusing after downloading five megabytes into a component that
   * will not draw them is what the viewer used to do at a tenth of the size.
   */
  const presentation = assetPresentation(asset, content?.length);
  const tooLarge = presentation === 'too-large';
  const readable =
    presentation === 'document' || presentation === 'code' || presentation === 'lines';
  const [error, setError] = useState<string | null>(null);
  /** Bumped by "Try again"; the only thing that re-runs the read. */
  const [attempt, setAttempt] = useState(0);
  const [previewedThemeDocument, setPreviewedThemeDocument] = useState<string | null>(null);
  /**
   * The one decision a previewed theme offers, pinned rather than scrolled to.
   *
   * The library drew its own Apply between the preview and the appearance
   * settings, and the settings are several screens long on a phone: the device
   * run had to scroll 900px to reach the confirm on a theme it had just opened.
   * Taking the action (`onPrimaryActionChange`) moves it to the bottom bar
   * below, where the viewer's other permanent controls already are, and stops
   * the library drawing the inline one. `setPrimary` is a `useState` setter, so
   * its identity is stable and the library reports again only when the action
   * itself changes; the same contract the detail route has used since #834.
   */
  const [primary, setPrimary] = useState<ThemePrimaryAction | null>(null);
  const themeDocumentIdentity = `${asset.id}:${asset.modified_unix_ms}`;
  const themeManifest = useMemo(
    () => themeFromDocument(asset.name, content),
    [asset.name, content]
  );
  /**
   * A packaged theme, fetched and opened without leaving this file.
   *
   * A `.muqun-theme` is a ZIP, so none of the viewer's text paths apply and the
   * reader used to be told to go and find the file themselves -- for a package
   * an agent had just written into this very session. The gateway serves it on
   * the same endpoint that feeds the image viewer, so the whole trip is: tap,
   * watch it arrive, and look at it here.
   *
   * `prepared` holds decoded artwork and must be disposed. This owns it, which
   * is why `CustomThemeLibrary` is told it does not.
   */
  const packaged = /\.muqun-theme$/i.test(asset.name);
  const [pack, setPack] = useState<ThemeEditorCandidate | null>(null);
  const [packProgress, setPackProgress] = useState<{ done: number; total: number | null } | null>(
    null
  );
  useEffect(() => () => pack?.prepared?.dispose(), [pack]);
  /**
   * The download and the staging, owned until the state above takes them.
   *
   * Closing the viewer mid-download used to orphan a whole staged directory
   * under `Paths.cache`: the cleanup on the effect above had already run --
   * against a `pack` that was still null -- and the `setPack` that arrived
   * afterwards on an unmounted component went nowhere, so the images just
   * decoded themselves onto the disk and stayed there. Nothing ever collected
   * them; `collectThemeAssetGarbage` only sweeps the *installed* directory.
   *
   * The discipline is `ThemeLinkImport`'s, not a second one: a request owns the
   * work, unmount cancels it, `handoff` is the single boundary where ownership
   * moves to whoever disposes next, and the `finally` disposes whenever it did
   * not. `handoff` throws on an aborted signal before it sets its flag, which is
   * what closes the gap between the last check and the assignment.
   */
  const active = useRef<ThemeImportRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.cancel();
      active.current = null;
    };
  }, []);
  async function openPackagedTheme() {
    if (packProgress || active.current) return;
    const request = new ThemeImportRequest();
    active.current = request;
    setError(null);
    setPackProgress({ done: 0, total: asset.size || null });
    let prepared: PreparedThemeAssets | undefined;
    let transferred = false;
    return settleAfter(
      async () => {
        try {
          const bytes = await readAssetBytes(asset, {
            signal: request.signal,
            maxBytes: THEME_LIMITS.packageBytes,
            onProgress: (done, total) => {
              if (mounted.current && !request.signal.aborted) setPackProgress({ done, total });
            },
          });
          const unpacked = unpackTheme(bytes);
          prepared = await prepareThemeAssets(unpacked, { signal: request.signal });
          const candidate = { manifest: unpacked.manifest, prepared };
          request.handoff(() => setPack(candidate));
          transferred = true;
        } catch (failure) {
          // A read this screen itself cancelled is not a failure to report: there is
          // no longer a screen to report it on.
          if (mounted.current && !request.isCanceled)
            setError(describeGatewayFailure(failure, t`Could not open this theme.`).message);
        }
      },
      () => {
        if (!transferred) prepared?.dispose();
        if (active.current === request) active.current = null;
        if (mounted.current) setPackProgress(null);
      }
    );
  }

  useEffect(() => {
    if (!readable) return;
    let active = true;
    // Closing the viewer, or moving to another file, cancels the read in
    // flight. Without it the download runs to completion into a component that
    // has gone, holding the socket and the bytes for nobody.
    const controller = new AbortController();
    setContent(null);
    setError(null);
    readAssetText(asset, { signal: controller.signal })
      .then((text) => {
        if (active) setContent(text);
      })
      .catch((failure: unknown) => {
        // A read this component itself cancelled is not a failure to report:
        // there is no longer a screen to report it on.
        if (active) {
          setError(describeGatewayFailure(failure, t`Could not open this file.`).message);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [asset, attempt, readable, t]);

  const subtitle = [formatAssetSize(asset.size), relativeTime(asset.modified_unix_ms)]
    .filter(Boolean)
    .join(' · ');

  /**
   * The whole file, to the clipboard.
   *
   * The code viewer virtualizes its lines, so a drag selects within one line
   * and not across the document -- which is the correct trade for a file that
   * can be ten thousand lines long, but it does take away the only way there
   * was to get the text out. This is that way, and it is a better one: nobody
   * was dragging a selection over 200 KB.
   */
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (content === null) return;
    void Clipboard.setStringAsync(content).then(() => setCopied(true));
  }, [content]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    // `fade`, not `slide`: a document is opened, not pulled up. The slide read
    // as a half sheet that had stopped short even though the window was always
    // full bleed, and it put this surface in a different category from the
    // image lightbox, which is the same act on the same listing. Both are now
    // full screen and neither travels.
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}>
      {/* Both insets are paid here rather than per body: the fill is on this
          view, so padding it keeps the colour edge to edge while the content
          stays clear of the status bar and the gesture bar.

          `SheetFrame` rather than a flat `colors.background`: this is the one
          themed surface in the app that was painting its own floor, so a pack
          with a `shell.background` had a wallpaper everywhere except here. It
          stays a `Modal` and not a route because it is opened from *inside* the
          files form sheet, where it would be a third subview of a layout that
          lays out two -- the constraint the comment over `AssetViewer` in
          `session-artifacts.tsx` records. And it keeps square corners and no
          grabber, for the same reason `SheetHandle` draws nothing inside a
          fullscreen frame: this is a full-bleed viewer, not a sheet that can be
          dragged away, and rounding the top of something that fills the screen
          is a corner over nothing.

          `frosted`, like every other sheet. Without it the wallpaper showed at
          full strength under whatever was open -- a README's paragraphs, a
          file's details -- and a full-cover pack made them unreadable. The
          veil follows the reader's opacity slider down to its floor, exactly
          as the files sheet this opened from does. A picture never lands here:
          it opens in the lightbox, on its own black matte. */}
      <View style={styles.sheet}>
        <SheetFrame tint="background" frosted>
          <View style={[styles.sheetColumn, { paddingBottom: insets.bottom }]}>
            {/* SafeAreaView reports zero insets inside a native Modal, so pad from
            the root provider's insets instead.

            `zIndex` and `elevation` are not decoration: the way out of this
            screen lives in here, and it has to stay on top of, and ahead of,
            whatever the body puts on the screen -- including a loading state
            that fills the rest of it. A viewer you cannot leave while it is
            loading is worse than one that fails. */}
            <View style={[styles.headerLayer, { paddingTop: insets.top }]}>
              {/* The sheet's own heading, on the sheet's gutter: the file's name
                  is the title and its size and age are the caption, and the
                  two round controls are its trailing edge. Every body below
                  starts on the same left edge as this name. */}
              <View style={styles.header}>
                <SheetSceneHeading
                  title={asset.name}
                  caption={subtitle}
                  trailing={
                    <View style={styles.headerControls}>
                      {content ? (
                        <PressableScale
                          accessibilityLabel={t`Copy`}
                          onPress={copy}
                          style={[
                            styles.close,
                            { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                          ]}>
                          {copied ? (
                            <Check size={18} color={theme.colors.success} />
                          ) : (
                            <Copy size={18} color={theme.colors.text} />
                          )}
                        </PressableScale>
                      ) : null}
                      <PressableScale
                        accessibilityLabel={t`Close file`}
                        onPress={onClose}
                        style={[
                          styles.close,
                          { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                        ]}>
                        <X size={18} color={theme.colors.text} />
                      </PressableScale>
                    </View>
                  }
                />
              </View>
            </View>

            {pack ? (
              <ScrollView contentContainerStyle={styles.themePreview}>
                <CustomThemeLibrary
                  key={`${themeDocumentIdentity}:pack`}
                  initialCandidate={pack}
                  detail
                  // The prepared artwork belongs to this screen, which disposes it
                  // when the reader closes the file.
                  ownsPreparedAssets={false}
                  onClosePreview={() => setPack(null)}
                  onPrimaryActionChange={setPrimary}
                />
              </ScrollView>
            ) : previewedThemeDocument === themeDocumentIdentity && themeManifest ? (
              <ScrollView contentContainerStyle={styles.themePreview}>
                <CustomThemeLibrary
                  key={themeDocumentIdentity}
                  initialManifest={themeManifest}
                  detail
                  onClosePreview={() => setPreviewedThemeDocument(null)}
                  onPrimaryActionChange={setPrimary}
                />
              </ScrollView>
            ) : (
              <>
                {themeManifest ? (
                  <View style={styles.themeEntry}>
                    <Button
                      testID="asset-preview-theme"
                      onPress={() =>
                        setPreviewedThemeDocument(themeDocumentIdentity)
                      }>{t`Preview`}</Button>
                  </View>
                ) : packaged ? (
                  <View style={styles.themeEntry}>
                    <Button
                      testID="asset-open-theme-package"
                      disabled={Boolean(packProgress)}
                      onPress={() => void openPackagedTheme()}>{t`Preview`}</Button>
                    {packProgress ? (
                      <ThemeImportProgress
                        label={t`Downloading theme`}
                        receivedBytes={packProgress.done}
                        completed={packProgress.done}
                        total={packProgress.total ?? undefined}
                      />
                    ) : null}
                  </View>
                ) : null}
                <AssetBody
                  asset={asset}
                  presentation={presentation}
                  readable={readable}
                  tooLarge={tooLarge}
                  content={content}
                  error={error}
                  markdownStyle={markdownStyle}
                  onRetry={() => setAttempt((previous) => previous + 1)}
                />
              </>
            )}

            {/* Pinned, for the same reason the detail route pins its own: the
                confirm for a theme sits under a preview and a column of
                appearance settings, and one you have to go looking for is one
                the reader has already decided against. `KeyboardStickyView`
                rather than a plain bar because this viewer is the one place a
                theme is read next to a file: nothing here opens a keyboard
                today, and if something does the button rides above it instead
                of underneath. The column already pays the bottom inset. */}
            {primary ? (
              <KeyboardStickyView offset={{ closed: 0, opened: -insets.bottom }}>
                <View style={styles.themeAction}>
                  <SheetSceneAction
                    // The id belongs to the apply: `theme-document` looks for it
                    // on a theme that is not the current one, and
                    // `custom-themes` presses it and then checks it has gone.
                    testID={primary.applies ? 'theme-apply' : undefined}
                    label={primary.applies ? t`Apply theme` : t`Done`}
                    disabled={primary.disabled}
                    onPress={primary.run}
                  />
                </View>
              </KeyboardStickyView>
            ) : null}
          </View>
        </SheetFrame>
      </View>
    </Modal>
  );
}

function AssetBody({
  asset,
  presentation,
  readable,
  tooLarge,
  content,
  error,
  markdownStyle,
  onRetry,
}: {
  asset: SessionAsset;
  presentation: AssetPresentation;
  readable: boolean;
  /** Text, but past the size the app will hold; nothing was read. */
  tooLarge: boolean;
  content: string | null;
  error: string | null;
  markdownStyle: ReturnType<typeof createMarkdownStyle>;
  onRetry: () => void;
}) {
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();

  const theme = useThemeTokens();

  /** A markdown file is a document; everything else is code, whatever it is called. */
  const document = presentation === 'document';
  const documentText = useMemo(
    () =>
      content === null || !document
        ? content
        : rewriteMessageImages(content, documentImageResolver, (alt) => {
            const label = alt.trim() ? t`Image unavailable: ${alt.trim()}` : t`Image unavailable`;
            return `*${escapeMarkdownText(label)}*`;
          }),
    [content, document, t]
  );

  /**
   * What the highlighted renderer is handed, when it is the one drawing.
   *
   * Source, config, a log, a diff, a `.txt` -- wrapped in one fenced block
   * named after its extension, and highlighted natively. There is no JavaScript
   * tokenizer here and never was: this is the only path in the app that
   * colours code, and above `HIGHLIGHT_MAX_CHARS` it is not the path taken.
   */
  const source = useMemo(() => {
    if (content === null || presentation !== 'code') return '';
    return fencedFile(content, fenceLanguageForFile(asset.name));
  }, [asset.name, content, presentation]);

  /**
   * The same file as rows, when it is past the size one native pass can lay
   * out. Built once per file rather than per render: a megabyte is split on
   * newlines exactly once, and `CodeLinesView` reads the result.
   */
  const index = useMemo(() => {
    if (content === null || presentation !== 'lines') return null;
    return indexTextLines(content);
  }, [content, presentation]);

  /**
   * The path, for a file the reader has to go and open somewhere else.
   *
   * The header's copy action needs the file's text and a refused file has none,
   * so the one thing worth carrying away is where it is. Same feedback as the
   * header: a word, for as long as a tick lasts there.
   */
  const [pathCopied, setPathCopied] = useState(false);
  const copyPath = useCallback(() => {
    void Clipboard.setStringAsync(asset.path).then(() => setPathCopied(true));
  }, [asset.path]);
  useEffect(() => {
    if (!pathCopied) return;
    const timer = setTimeout(() => setPathCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [pathCopied]);

  // The states of one viewer, and they used to be bare returns: the spinner
  // ceased to exist and a full page of markdown existed, on the same frame. Each branch is now a layer of its own, keyed so React tears the old
  // one down rather than reusing it, and the two overlap for the length of a
  // short fade -- which is what makes a document read as having arrived rather
  // than as having replaced something.
  if (presentation === 'audio') return <AudioAssetPreview asset={asset} />;
  if (tooLarge) {
    // The one refusal left, and the only one that says a number. It is reached
    // before a byte is read, so what it offers is the way to the file rather
    // than the file: nothing here has the text to put on the clipboard.
    const size = formatAssetSize(asset.size);
    const ceiling = formatAssetSize(MAX_ASSET_TEXT_BYTES);
    return (
      <AssetBodyLayer id="too-large">
        <View style={styles.centerState}>
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centerText}>
            {/* react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs. */}
            {t`This file is ${size}. Muqun opens text files up to ${ceiling}; larger ones stay on the server.`}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} selectable>
            {asset.path}
          </Text>
          <PressableScale
            testID="asset-copy-path"
            accessibilityRole="button"
            accessibilityLabel={pathCopied ? t`Copied` : t`Copy path`}
            onPress={copyPath}
            style={[
              styles.retry,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
            ]}>
            <Text variant="caption" color={theme.colors.primary}>
              {pathCopied ? t`Copied` : t`Copy path`}
            </Text>
          </PressableScale>
        </View>
      </AssetBodyLayer>
    );
  }

  if (!readable) {
    return (
      <AssetBodyLayer id="details">
        <AssetDetails asset={asset} />
      </AssetBodyLayer>
    );
  }

  if (error) {
    return (
      <AssetBodyLayer id="error">
        <View style={styles.centerState}>
          <Text variant="bodySmall" color={theme.colors.danger} selectable>
            {error}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} selectable>
            {asset.path}
          </Text>
          {/* A failure is not a dead end: the read is cheap to repeat and the
              usual cause -- a gateway that went away for a moment -- usually is
              not there on the second ask. Closing is the other way out, and it
              is in the header, which stays above this. */}
          <PressableScale
            accessibilityLabel={t`Try again`}
            onPress={onRetry}
            style={[
              styles.retry,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
            ]}>
            <Text variant="caption" color={theme.colors.primary}>
              <Trans>Try again</Trans>
            </Text>
          </PressableScale>
        </View>
      </AssetBodyLayer>
    );
  }

  if (content === null) {
    return (
      <AssetBodyLayer id="loading">
        {/* `pointerEvents="none"`: a loading state is a statement, not a
            control, and a full-height view that swallows touches while it waits
            is how one turns into a trap.

            Paragraphs rather than a spinner. What is coming is a page of text,
            and a spinner centred in an empty screen says only "wait" -- where
            this says what the wait is for, in the shape and at the position the
            text will land in, so nothing moves when it does. */}
        <View style={styles.skeletonBody} pointerEvents="none">
          <Skeleton variant="text" width="48%" height={20} />
          <Skeleton variant="text" lines={4} height={13} style={styles.skeletonParagraph} />
          <Skeleton variant="text" lines={3} height={13} style={styles.skeletonParagraph} />
          <Skeleton variant="rect" width="100%" height={72} style={styles.skeletonParagraph} />
          <Skeleton variant="text" lines={2} height={13} style={styles.skeletonParagraph} />
        </View>
      </AssetBodyLayer>
    );
  }

  if (!content.trim()) {
    return (
      <AssetBodyLayer id="empty">
        <View style={styles.centerState}>
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            <Trans>This file is empty.</Trans>
          </Text>
        </View>
      </AssetBodyLayer>
    );
  }

  if (document) {
    // A document of any length, a block at a time. A README is one cell; a
    // 300 KB changelog is eighty, and only the ones near the viewport exist.
    return (
      <AssetBodyLayer id="document">
        <MarkdownDocumentView
          testID="asset-document"
          markdown={documentText ?? content}
          markdownStyle={markdownStyle}
          selectionColor={theme.colors.primarySubtle}
          contentInsets={DOCUMENT_INSETS}
        />
      </AssetBodyLayer>
    );
  }

  if (index) {
    // Past the size one native layout pass stays linear at. Rows, numbered,
    // pannable, and on screen in the time it takes to split a string.
    return (
      <AssetBodyLayer id="lines">
        <CodeLinesView
          testID="asset-lines"
          lines={index.lines}
          longest={index.longest}
          markdownStyle={markdownStyle}
          inset={SHEET_LADDER.gutter}
          note={t`Too large to highlight — showing plain text.`}
        />
      </AssetBodyLayer>
    );
  }

  return (
    <AssetBodyLayer id="code">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.documentContent}
        showsVerticalScrollIndicator={false}>
        {/* github flavor, and it is doing two jobs here. Tables are a GFM
            extension and the commonmark renderer runs their cells together as
            inline text -- and a fenced block is a component of its own under
            this flavor, with a header naming the language, a copy button, and a
            code pane that scrolls sideways instead of wrapping. Wrapping is
            what breaks the column alignment a log or a diff is read for, so
            that last part is not a detail. Static content, so the streaming
            guidance for commonmark does not apply here. */}
        <EnrichedMarkdownText
          flavor="github"
          markdown={source}
          markdownStyle={markdownStyle}
          containerStyle={styles.markdown}
          selectable
          selectionColor={theme.colors.primarySubtle}
          selectionHandleColor={theme.colors.primary}
          streamingAnimation={false}
          textBreakStrategy="simple"
          md4cFlags={{ latexMath: true }}
          onLinkPress={({ url }) => {
            if (isSafeExternalLink(url)) void Linking.openURL(url);
          }}
        />
      </ScrollView>
    </AssetBodyLayer>
  );
}

/**
 * The wrapper every one of the viewer's states shares.
 *
 * The `key` is what does the work: without it React keeps one host view across
 * the change and neither the exit nor the entrance ever runs, which is exactly
 * how different bodies came to hand over in a single frame.
 */
function AssetBodyLayer({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Animated.View
      key={id}
      entering={fadeIn('short')}
      exiting={fadeOut('micro')}
      style={styles.bodyLayer}>
      {children}
    </Animated.View>
  );
}

/**
 * For a PDF, a video or a binary: say what it is and where it stays, and stop
 * there.
 *
 * Label and value straight on the frosted ground, a hairline between one fact
 * and the next, on the sheet's gutter -- the sheet's own rows rather than a
 * card. A raised card here was the one box on the viewer's ground.
 */
function AssetDetails({ asset }: { asset: SessionAsset }) {
  const { t } = useLingui();
  const relativeTime = useRelativeTime();

  const theme = useThemeTokens();
  const rows: { label: string; value: string }[] = [
    { label: t`Type`, value: asset.mime || asset.kind },
    { label: t`Size`, value: formatAssetSize(asset.size) || t`unknown` },
    { label: t`Modified`, value: relativeTime(asset.modified_unix_ms) || t`unknown` },
    { label: t`Path`, value: asset.path },
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.detailsContent}>
      <Text variant="bodySmall" color={theme.colors.textMuted}>
        <Trans>No preview for this kind of file. It stays on the server.</Trans>
      </Text>
      <View>
        {rows.map((row, index) => (
          <View
            key={row.label}
            style={[
              styles.detailsRow,
              index > 0
                ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }
                : null,
            ]}>
            <Text variant="caption" color={theme.colors.textMuted}>
              {row.label}
            </Text>
            <Text variant="caption" selectable style={styles.detailsValue}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * The document's insets: the sheet's gutter either side, no lead above -- the
 * heading's own bottom room is the lead -- and room to scroll the last block
 * clear of the gesture bar.
 */
const DOCUMENT_INSETS = { top: 0, bottom: 40, horizontal: SHEET_LADDER.gutter };

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  // The ground fills the sheet; the column inside it pays the bottom inset, so
  // the wallpaper still reaches the gesture bar.
  sheetColumn: {
    flex: 1,
  },
  // Both properties, because they are two different platforms' answer to the
  // same question: `zIndex` orders the layer on iOS, `elevation` is what
  // Android actually draws and hit-tests by.
  headerLayer: {
    zIndex: 1,
    elevation: 1,
  },
  // The bar the theme confirm sits in: the viewer's own gutter, and enough room
  // above the column's bottom inset that the button is not on the edge.
  themeAction: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingTop: 12,
    paddingBottom: 12,
  },
  header: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingTop: SHEET_LADDER.gap,
    paddingBottom: SHEET_LADDER.snug,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // A theme previewed in place: the library's own column, on the gutter.
  themePreview: {
    padding: SHEET_LADDER.gutter,
    gap: 16,
  },
  themeEntry: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingBottom: SHEET_LADDER.snug,
    gap: 8,
  },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  // The fenced listing on the sheet's gutter. The fence draws its own code
  // fill and pans sideways inside it, so lines are never wrapped.
  documentContent: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingBottom: 40,
  },
  markdown: {
    width: '100%',
  },
  detailsContent: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingBottom: 40,
    gap: SHEET_LADDER.gap,
  },
  detailsRow: {
    gap: 2,
    paddingVertical: SHEET_LADDER.gap,
  },
  detailsValue: {
    // Paths are long and mid-word breaks are unreadable; let it wrap instead.
    flexShrink: 1,
  },
  bodyLayer: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingVertical: 24,
  },
  // The refusal is a sentence with two numbers in it, not a label: it wraps,
  // and it reads as prose centred under nothing rather than as a ragged column.
  centerText: {
    textAlign: 'center',
  },
  // The same padding the markdown body uses, so the placeholder lines sit where
  // the paragraphs replacing them will.
  skeletonBody: {
    flex: 1,
    paddingHorizontal: SHEET_LADDER.gutter,
  },
  skeletonParagraph: {
    marginTop: 18,
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 17,
    borderCurve: 'continuous',
  },
  // The lightbox's own backdrop, worn early: the loading state opens on the
  // same black the picture will land on, so arrival changes the content and
  // not the room. The close chip copies the lightbox's, for the same reason.
  encryptedLoading: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  encryptedLoadingClose: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.30)',
    zIndex: 1,
    elevation: 1,
  },
});
