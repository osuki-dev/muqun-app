import { InlineFileLink } from '@/components/inline-file-link';
import { ContentImage } from '@/components/content-image';
import { contentImageIdentity, type ContentImagePreviewState } from '@/lib/content-image-layout';
import { isPdfFile } from '@/lib/session-assets';
import { isThemeFilePath } from '@/lib/audio-markdown';
import { videoFileMime } from '@/lib/media-file';
import { InlineVideoFile } from '@/components/video-asset-preview';
import { InlineAudioFile } from '@/components/audio-asset-preview';
import { memo, useCallback, useMemo, useState } from 'react';
import { Modal, StyleSheet, View, type ViewInstance } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeTokens, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { Trans, useLingui } from '@lingui/react/macro';
import { plural } from '@lingui/core/macro';
import { AppearanceIcon, DoneIcon, DocumentIcon, StartIcon, CloseIcon } from '@/icons';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { BoundedMarkdown, TruncationFooter } from '@/components/bounded-markdown';
import { StatusDot } from '@/components/status-dot';
import { AgentTodoBlock } from '@/components/agent-todo-block';
import { AgentSleepToolBody } from '@/components/agent-sleep-tool-body';
import {
  AgentMuqunToolBody,
  MuqunToolState,
  muqunOperationWord,
  muqunStatusWord,
} from '@/components/agent-muqun-tool-body';
import { muqunToolPresentation } from '@/lib/muqun-tool-presentation';
import { formatToolDuration } from '@/lib/tool-call-detail';
import { FileTextBody } from '@/components/file-text-body';
import {
  GatewayImageThumbnail,
  UnmappedImageThumbnail,
} from '@/components/gateway-image-thumbnail';
import {
  messageImageForSource,
  withMessageImageFiles,
  unavailableMessageImage,
} from '@/lib/gateway-image-previews';
import type { MessageImageAsset } from '@/lib/message-images';
import { SheetFrame } from '@/components/sheet-ground';
import { canInlineFileText, readFilePreview, toolFileForPath } from '@/lib/file-text-preview';
import {
  EmbeddedTerminalToolBlock,
  isToolPending,
  type ToolExpansionIntent,
} from '@/components/embedded-terminal-tool-block';
import { InlineDiffRows } from '@/components/diff-rows';
import { usePaneChatColors, usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useCompactMarkdownStyle } from '@/hooks/use-markdown-style';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { isDeclinedByUser } from '@/lib/agent-engine-text';
import { hasMarkdownMarks, plainFromMarkdown } from '@/lib/markdown-text';
import { withAlpha } from '@/lib/color';
import { markdownPaletteKey } from '@/lib/markdown-palette';
import { TOOL_BODY_MAX_LINES, capToolBody } from '@/lib/markdown-cap';
import { diffRowsForFence, diffRowsFromPatches, diffTotals } from '@/lib/agent-diff-rows';
import {
  basename,
  capLines,
  classifyTool,
  contentTypeFromMetadata,
  diffFilesFromMetadata,
  dirname,
  editFilesFromMetadata,
  executeErrored,
  executeToolCalls,
  extractCaption,
  extractTarget,
  fenceLanguageForPath,
  fencedCode,
  filesFromContent,
  groupGrepMatches,
  groupPathsByDirectory,
  parsePatchSections,
  parseToolOutput,
  parseToolQuestions,
  questionAnswersFromMetadata,
  QUESTION_MAX,
  QUESTION_OPTION_MAX,
  resultCountFromMetadata,
  searchProviderFromMetadata,
  shellExitFromMetadata,
  shellIdFromMetadata,
  shellTimedOutFromMetadata,
  skillDirectoryFromMetadata,
  skillNameFromMetadata,
  splitUrl,
  textFromContent,
  toolArgumentLine,
  toolInputJson,
  toolInputRecord,
  type ToolKind,
  type ToolQuestion,
} from '@/lib/agent-tool-output';
import { toolDurationMs, type AgentSessionInfo, type ToolPart } from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';
import { subagentInlineContent, subagentPresentation } from '@/lib/agent-subagent-presentation';
import { subagentActionWord, subagentStateWord } from '@/i18n/labels';

/**
 * One tool call, drawn as what it actually is.
 *
 * Every tool used to end up in the same place: a one-line header and, behind an
 * expand, whatever `parseToolOutput` had made of the result -- which for
 * anything the classifier did not recognise was `JSON.stringify(value, null,
 * 2)` of the whole payload. An `edit` carries a ready-to-render unified diff in
 * `metadata.files`; a `read` can carry an image; a `grep` prints a structure a
 * list can be made of; a `subagent` carries the id of the session it started.
 * None of that reached the reader.
 *
 * So there is one body per family here, all inside the one shell, and the
 * unrecognised case is a card of its own rather than a fallback into raw JSON:
 * OpenCode's advertised toolset is agent- and config-dependent and an MCP
 * server adds whatever it likes, so "a tool this build has never heard of" is
 * the normal case, not the broken one.
 */

export interface AgentToolCardProps {
  audioSessionId?: string;
  part: ToolPart;
  markdownStyle: MarkdownStyle;
  /** The observed identity and state of this exact child session. */
  childSession?: AgentSessionInfo;
  onOpenChildSession?: (asid: string) => void;
  /** `POST …/background`, offered while a foreground tool is still running. */
  onRunInBackground?: () => void;
  /**
   * The background tray. A `shell` names the shell it is running in, so the
   * tray can open that one rather than the list it belongs to.
   */
  onOpenBackgroundTray?: (shellId?: string) => void;
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  /** The virtualised changes viewer, for a patch too big to draw in a cell. */
  onOpenFullDiff?: (path?: string) => void;
  /** The whole call in its own sheet, offered inside expanded content. */
  onOpenDetail?: () => void;
  onExpand?: (header: ViewInstance) => ToolExpansionIntent | undefined;
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

const Chip = memo(function Chip({ text, color }: { text: string; color: string }) {
  return (
    <Text variant="caption" weight="semibold" color={color} style={styles.chipText}>
      {text}
    </Text>
  );
});

/**
 * Monospace body, syntax-highlighted when the renderer has a grammar for it,
 * and never longer than one native view can measure.
 *
 * A `read` of a five-thousand-line file used to be inlined whole: one shadow
 * node measuring ~70,000px, a layout Fabric could not settle, and an abort.
 * Four hundred lines is what a card draws; the rest is a tap away, and the
 * whole file is one tap further, in the viewer that is built to scroll it.
 */
const CodeBody = memo(function CodeBody({
  body,
  language,
  markdownStyle,
  onOpenInViewer,
}: {
  body: string;
  language?: string;
  markdownStyle: MarkdownStyle;
  onOpenInViewer?: () => void;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const colors = usePaneChatColors();
  const [budget, setBudget] = useState(TOOL_BODY_MAX_LINES);
  const capped = useMemo(() => capToolBody(body, budget), [body, budget]);
  const fenced = useMemo(() => fencedCode(capped.text, language), [capped.text, language]);
  // The card is the surface; the code block inside it draws no box of its own.
  const flat = useMemo<MarkdownStyle>(
    () => ({
      ...markdownStyle,
      codeBlock: {
        ...markdownStyle.codeBlock,
        backgroundColor: 'transparent',
        borderWidth: 0,
        padding: 0,
        marginTop: 0,
        marginBottom: 0,
      },
    }),
    [markdownStyle]
  );
  return (
    <View style={styles.stretch}>
      <EnrichedMarkdownText
        key={markdownPaletteKey(markdownStyle)}
        flavor="commonmark"
        markdown={fenced.text}
        markdownStyle={flat}
        containerStyle={styles.stretch}
        selectable
        streamingAnimation={false}
        textBreakStrategy="simple"
      />
      {capped.hidden > 0 ? (
        <TruncationFooter
          note={t`${plural(capped.hidden, { one: '# more line', other: '# more lines' })}`}
          onShowMore={() => setBudget((prev) => prev + TOOL_BODY_MAX_LINES)}
          showMoreLabel={t`Show more`}
          extra={
            onOpenInViewer ? (
              <PressableScale
                testID="agent-tool-open-viewer"
                accessibilityRole="button"
                accessibilityLabel={t`Open in viewer`}
                onPress={onOpenInViewer}
                style={[styles.moreChip, { borderRadius: profile.chrome.control }]}>
                <Text variant="caption" color={colors.accent}>
                  {t`Open in viewer`}
                </Text>
              </PressableScale>
            ) : null
          }
        />
      ) : null}
    </View>
  );
});

/**
 * Output, capped, with the rest one tap away.
 *
 * The cap is the point: a tool result is up to 64 KiB and a timeline cell is
 * not a scroll container, so the card draws a bounded number of lines and says
 * how many it is not drawing.
 */
const OutputLines = memo(function OutputLines({ text }: { text: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const colors = usePaneChatColors();
  const mono = useMonoFontFamily();
  // "Show the rest" used to mean the whole 64 KiB, in one `<Text>`. It means
  // another four hundred lines now, and says so.
  const [budget, setBudget] = useState(0);
  const capped = useMemo(
    () => (budget === 0 ? capLines(text) : capToolBody(text, budget)),
    [text, budget]
  );

  if (!text) return null;
  return (
    <View style={styles.stretch}>
      <Text selectable style={[styles.mono, { color: theme.colors.textMuted, fontFamily: mono }]}>
        {capped.text}
      </Text>
      {capped.hidden > 0 ? (
        <PressableScale
          testID="agent-tool-output-expand"
          accessibilityRole="button"
          accessibilityLabel={t`Show the rest of this output`}
          onPress={() =>
            setBudget((prev) => (prev === 0 ? TOOL_BODY_MAX_LINES : prev + TOOL_BODY_MAX_LINES))
          }
          style={[styles.moreChip, { borderRadius: profile.chrome.control }]}>
          <Text variant="caption" color={colors.accent}>
            {t`${plural(capped.hidden, { one: '# more line', other: '# more lines' })}`}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
});

/** A `Tool.FileContent` whose mime says it can be drawn rather than opened. */
const IMAGE_MIME_PREFIX = 'image/';

function isImageFile(file: { mime?: string }): boolean {
  return (file.mime ?? '').startsWith(IMAGE_MIME_PREFIX);
}

function LegacyToolImage({
  uri,
  label,
  onPreviewImage,
}: {
  uri: string;
  label: string;
  onPreviewImage?: (uri: string) => void;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const [previewState, setPreviewState] = useState<ContentImagePreviewState>();
  return (
    <PressableScale
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityHint={
        previewState?.identity === contentImageIdentity({ uri }) && previewState.cropped
          ? t`Cropped preview · Open full image`
          : undefined
      }
      onPress={() => onPreviewImage?.(uri)}
      style={[styles.fileThumbWrap, { borderRadius: profile.chrome.surface }]}>
      <ContentImage
        source={{ uri }}
        previewable={Boolean(onPreviewImage)}
        onPreviewStateChange={setPreviewState}
      />
    </PressableScale>
  );
}

/** The files a tool returned: images inline, everything else as a chip. */
const ToolFiles = memo(function ToolFiles({
  files,
  imageAssets,
  imageAttachments,
  audioSessionId,
  onPreviewImage,
  onOpenFile,
}: {
  files: readonly { uri: string; mime?: string; name?: string }[];
  imageAssets?: readonly MessageImageAsset[];
  imageAttachments?: readonly string[];
  audioSessionId?: string;
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const raised = useTranscriptPlate('raised');
  const profile = useAppearanceProfile();
  const displayedFiles = useMemo(
    () => withMessageImageFiles(files, imageAssets, imageAttachments),
    [files, imageAssets, imageAttachments]
  );

  return (
    <View style={styles.fileRow}>
      {displayedFiles.map((file) => {
        const image = messageImageForSource(imageAssets, file.uri);
        if (image)
          return (
            <GatewayImageThumbnail
              key={file.uri}
              asset={image}
              label={file.name ?? t`Open image`}
              style={{ borderRadius: profile.chrome.surface }}
            />
          );
        if (audioSessionId && videoFileMime(file)) {
          return (
            <InlineVideoFile
              key={`${audioSessionId}:${file.uri}`}
              file={file}
              asid={audioSessionId}
            />
          );
        }
        if (audioSessionId && isPdfFile(file)) {
          return (
            <InlineFileLink
              key={`${audioSessionId}:${file.uri}`}
              asid={audioSessionId}
              file={{ uri: file.uri, name: file.name ?? basename(file.uri) }}
            />
          );
        }
        if (audioSessionId && file.mime?.startsWith('audio/')) {
          return (
            <InlineAudioFile
              key={`${audioSessionId}:${file.uri}`}
              file={file}
              asid={audioSessionId}
            />
          );
        }
        if (isImageFile(file)) {
          return (
            <UnmappedImageThumbnail
              key={file.uri}
              uri={file.uri}
              unavailable={unavailableMessageImage(imageAssets, file.uri)}
              label={file.name ?? t`Open image`}
              style={[styles.fileThumb, { borderRadius: profile.chrome.surface }]}
              onPreviewImage={onPreviewImage}>
              <LegacyToolImage
                uri={file.uri}
                label={file.name ?? t`Open image`}
                onPreviewImage={onPreviewImage}
              />
            </UnmappedImageThumbnail>
          );
        }
        return (
          <PressableScale
            key={file.uri}
            accessibilityRole="button"
            accessibilityLabel={t`Open ${file.name ?? basename(file.uri)}`}
            onPress={() => onOpenFile?.(file)}
            style={[styles.fileChip, raised]}>
            <DocumentIcon size={13} color={theme.colors.primary} />
            <Text
              variant="caption"
              color={theme.colors.text}
              numberOfLines={1}
              style={styles.fileChipName}>
              {file.name ?? basename(file.uri)}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
});

/** The rows of one patch, inside a card. */
const PatchBody = memo(function PatchBody({
  patch,
  targetPath,
  onOpenFullDiff,
}: {
  patch: string;
  targetPath?: string;
  onOpenFullDiff?: (path?: string) => void;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const colors = usePaneChatColors();
  const rows = useMemo(() => diffRowsForFence(patch), [patch]);
  if (rows.length === 0) return null;
  return (
    <InlineDiffRows
      rows={rows}
      targetPath={targetPath}
      colors={colors}
      gutterFill={theme.colors.surface}
      headerFill={surfaceBackground(theme.colors.surface)}
      onGrid
      {...(onOpenFullDiff ? { onOpenFullDiff } : {})}
    />
  );
});

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export const AgentToolCard = memo(function AgentToolCard({
  audioSessionId,
  part,
  childSession,
  onOpenChildSession,
  onRunInBackground,
  onOpenBackgroundTray,
  onPreviewImage,
  onOpenFile,
  onOpenFullDiff,
  onOpenDetail,
  onExpand,
}: AgentToolCardProps) {
  const { t, i18n } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  // Read from the theme here, not from a prop: the timeline's memoised cells
  // skip re-renders the list cannot see, and a style handed down through
  // render props would stay the palette the cell was born with. A hook
  // subscribes this card to the theme itself, so a colour-mode switch reaches
  // it whatever the list decides.
  const markdownStyle = usePaneChatMarkdownStyle();
  const colors = usePaneChatColors();

  const kind = useMemo(() => classifyTool(part.name), [part.name]);
  const muqun = muqunToolPresentation(part);
  const muqunTitle = muqun
    ? [
        i18n._(muqunOperationWord[muqun.operation]),
        muqun.machine === 'self' ? t`This computer` : muqun.machine,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  /**
   * The input, or as much of it as has arrived.
   *
   * A pending card used to be a tool name and a pulse: no title, no body, no
   * chevron, because the input was still streaming and the whole of it was a
   * partial JSON string. `input_partial` is that text as the gateway has
   * concatenated it so far, and the values already in it are what the header
   * is drawn from -- so a shell card names its command while the command is
   * still being written, rather than a second after it has finished running.
   */
  const inputSource = useMemo(() => {
    if (toolInputRecord(part.input)) return part.input;
    return part.input_partial ?? part.input;
  }, [part.input, part.input_partial]);
  const input = useMemo(() => toolInputRecord(inputSource), [inputSource]);
  const target = useMemo(() => extractTarget(kind, inputSource), [kind, inputSource]);
  const caption = useMemo(() => extractCaption(kind, inputSource), [kind, inputSource]);
  const sleepDuration = sleepDurationMs(part.name, input);

  // `content` is the real result; `output` is the same text flattened and is
  // what an older gateway sends on its own.
  const outputText = useMemo(() => {
    const fromContent = textFromContent(part.content);
    return fromContent || parseToolOutput(part.output).stdout;
  }, [part.content, part.output]);
  const files = useMemo(() => filesFromContent(part.content), [part.content]);
  const hasFiles =
    files.length > 0 ||
    Boolean(
      part.image_attachments?.some((uri) =>
        part.image_assets?.some((asset) => asset.src === uri && asset.mime.startsWith('image/'))
      )
    );
  const parsed = useMemo(() => parseToolOutput(part.output), [part.output]);

  /**
   * Detached, however it got that way.
   *
   * `part.background` is the gateway's flag, set when the reader pressed "Run
   * in background". But `shell` and `subagent` both take `background: true` in
   * their own input -- the agent deciding on its own that this one runs
   * detached -- and a card started that way carried no badge at all, so a
   * command that would never block the loop looked exactly like one that did.
   */
  const detached =
    part.background === true ||
    ((kind === 'shell' || kind === 'subagent') && input?.background === true);

  const pending = isToolPending(part.state);
  // Only while it is pending: once the call has run, the result is what the
  // card is about and its arguments are in the body.
  const argumentLine = useMemo(() => (pending ? toolArgumentLine(input) : ''), [pending, input]);
  const durationMs = toolDurationMs(part.time, part.metadata);
  const truncated = part.truncated === true || parsed.truncated;
  const shellExit = shellExitFromMetadata(part.metadata) ?? parsed.exitCode;
  const resultFailed =
    (kind === 'shell' &&
      ((shellExit !== undefined && shellExit !== 0) || shellTimedOutFromMetadata(part.metadata))) ||
    (kind === 'execute' && executeErrored(part.metadata));

  /** The tray, opened on this call's own shell when the engine named one. */
  const handleOpenTray = useCallback(() => {
    const shellId = shellIdFromMetadata(part.metadata);
    onOpenBackgroundTray?.(shellId || undefined);
  }, [part.metadata, onOpenBackgroundTray]);

  const handleOpenChild = useCallback(() => {
    const childId = part.child_session_id;
    if (childId) onOpenChildSession?.(childId);
  }, [part.child_session_id, onOpenChildSession]);

  // ---- per-family reading ------------------------------------------------

  const editFiles = useMemo(
    () => (kind === 'edit' ? editFilesFromMetadata(part.metadata) : []),
    [kind, part.metadata]
  );
  /**
   * What a `patch` actually did, in preference to what it was asked to do.
   *
   * The tool answers with `metadata.files` -- real unified diffs, with the
   * additions, the deletions and the status OpenCode counted -- and the card
   * re-parsed `input.patchText` instead. That is the *request*: the
   * `*** Update File:` format, which is not a unified diff, whose totals the
   * card then had to guess at and got as two empty chips. `patchText` is still
   * read, for an engine or an MCP tool that answered without metadata.
   */
  const patchFiles = useMemo(
    () => (kind === 'patch' ? diffFilesFromMetadata(part.metadata) : []),
    [kind, part.metadata]
  );
  const patchSections = useMemo(() => {
    if (kind !== 'patch' || patchFiles.length > 0) return [];
    const text = input ? (input.patchText ?? input.patch_text ?? input.patch) : undefined;
    return typeof text === 'string' ? parsePatchSections(text) : [];
  }, [kind, input, patchFiles]);
  const grepGroups = useMemo(
    () => (kind === 'grep' ? groupGrepMatches(outputText) : []),
    [kind, outputText]
  );
  const globGroups = useMemo(
    () => (kind === 'glob' ? groupPathsByDirectory(outputText) : []),
    [kind, outputText]
  );
  const subagent = useMemo(
    () => (kind === 'subagent' ? subagentInlineContent(part.input, outputText) : null),
    [kind, part.input, outputText]
  );
  const child = useMemo(
    () =>
      kind === 'subagent' ? subagentPresentation(part, childSession, subagent?.state) : undefined,
    [kind, part, childSession, subagent?.state]
  );
  const childWorking =
    child?.state === 'working' || child?.state === 'starting' || child?.state === 'retrying';
  const childStatusLabel =
    kind === 'subagent'
      ? child?.state && child.state !== 'unknown'
        ? i18n._(subagentStateWord[child.state])
        : child?.action
          ? i18n._(subagentActionWord[child.action])
          : i18n._(subagentStateWord.unknown)
      : '';
  const questions = useMemo(
    () => (kind === 'question' ? parseToolQuestions(part.input) : []),
    [kind, part.input]
  );
  const answers = useMemo(
    () => (kind === 'question' ? questionAnswersFromMetadata(part.metadata) : []),
    [kind, part.metadata]
  );

  const writeContent = typeof input?.content === 'string' ? input.content : undefined;
  const oldString =
    typeof input?.oldString === 'string'
      ? input.oldString
      : typeof input?.old_string === 'string'
        ? input.old_string
        : undefined;
  const newString =
    typeof input?.newString === 'string'
      ? input.newString
      : typeof input?.new_string === 'string'
        ? input.new_string
        : undefined;

  /**
   * A theme the call wrote, previewed from the header in one tap.
   *
   * The skill has agents write `<slug>.muqun-theme.json` or a `.muqun-theme`
   * package; the reader should not have to expand the card and find the file.
   * The gateway resolves the path (relative ones against the session), exactly
   * as a tapped link does.
   */
  const themeFile = useMemo(() => {
    if (pending || part.error || !onOpenFile) return undefined;
    if (kind !== 'write' && kind !== 'edit' && kind !== 'patch') return undefined;
    const paths = [
      target,
      ...patchFiles.map((file) => file.path),
      ...patchSections.map((section) => section.path),
    ];
    return paths.find((path) => path && isThemeFilePath(path));
  }, [pending, part.error, onOpenFile, kind, target, patchFiles, patchSections]);

  // ---- chips -------------------------------------------------------------

  const chips = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const exit = shellExitFromMetadata(part.metadata) ?? parsed.exitCode;
    if (kind === 'shell' && exit !== undefined) {
      nodes.push(
        <Chip key="exit" text={`exit ${exit}`} color={exit === 0 ? colors.added : colors.removed} />
      );
    }
    // Killed for taking too long, which an exit code alone does not say: a
    // command that was cut off and one that failed on its own both end
    // non-zero, and only one of them is worth running again.
    if (kind === 'shell' && shellTimedOutFromMetadata(part.metadata)) {
      nodes.push(<Chip key="timeout" text={t`timed out`} color={theme.colors.warning} />);
    }
    if (kind === 'edit' || kind === 'patch') {
      // The tool's own count when it made one -- `metadata.files` for both
      // families -- and the before/after lengths only when it did not. A patch
      // used to have no first case at all, so its chips were always empty.
      const counted = kind === 'patch' ? patchFiles : editFiles;
      const totals =
        counted.length > 0
          ? diffTotals(counted)
          : {
              additions: newString ? newString.split('\n').length : 0,
              deletions: oldString ? oldString.split('\n').length : 0,
            };
      if (totals.additions > 0) {
        nodes.push(<Chip key="add" text={`+${totals.additions}`} color={colors.added} />);
      }
      if (totals.deletions > 0) {
        nodes.push(<Chip key="del" text={`−${totals.deletions}`} color={colors.removed} />);
      }
    }
    if (kind === 'write' && writeContent) {
      nodes.push(
        <Chip key="lines" text={`+${writeContent.split('\n').length}`} color={colors.added} />
      );
    }
    const count = resultCountFromMetadata(part.metadata);
    if ((kind === 'glob' || kind === 'grep' || kind === 'search') && count !== undefined) {
      nodes.push(
        <Chip
          key="count"
          text={t`${plural(count, { one: '# result', other: '# results' })}`}
          color={theme.colors.textMuted}
        />
      );
    }
    // The sandboxed code threw. The tool call itself succeeded -- it ran the
    // code and reported what happened -- so nothing else on the card says so.
    if (kind === 'execute' && executeErrored(part.metadata)) {
      nodes.push(<Chip key="err" text={t`error`} color={colors.removed} />);
    }
    if (kind === 'web') {
      // What came back, and who answered: a fetch states its content type and
      // a search states its provider, and neither reached the reader.
      const contentType = contentTypeFromMetadata(part.metadata);
      if (contentType) {
        nodes.push(<Chip key="type" text={contentType} color={theme.colors.textMuted} />);
      }
      const provider = searchProviderFromMetadata(part.metadata);
      if (provider) {
        nodes.push(<Chip key="provider" text={provider} color={theme.colors.textMuted} />);
      }
    }
    return nodes.length > 0 ? nodes : null;
  }, [
    kind,
    part.metadata,
    parsed.exitCode,
    colors,
    theme.colors.warning,
    editFiles,
    patchFiles,
    newString,
    oldString,
    writeContent,
    theme.colors.textMuted,
    t,
  ]);

  // ---- actions -----------------------------------------------------------

  const actions = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    // `ctrl+b` in the TUI: detach the foreground tools blocking the loop. The
    // shell keeps running and stays readable in the tray.
    if (kind === 'shell' && pending && !detached && onRunInBackground) {
      nodes.push(
        <PressableScale
          key="bg"
          testID="agent-tool-run-in-background"
          accessibilityRole="button"
          accessibilityLabel={t`Run in background`}
          onPress={onRunInBackground}
          style={styles.action}>
          <StartIcon size={11} color={colors.accent} />
          <Text variant="caption" color={colors.accent} style={styles.actionText}>
            <Trans>Run in background</Trans>
          </Text>
        </PressableScale>
      );
    }
    // Only while it is still running: the tray lists what is running, and a
    // finished command that says "Background tasks" sends the reader to an
    // empty sheet.
    if (detached && pending && onOpenBackgroundTray) {
      nodes.push(
        <PressableScale
          key="tray"
          testID="agent-tool-open-tray"
          accessibilityRole="button"
          accessibilityLabel={t`Open background tasks`}
          onPress={handleOpenTray}
          style={styles.action}>
          <Text variant="caption" color={colors.accent} style={styles.actionText}>
            <Trans>Background tasks</Trans>
          </Text>
        </PressableScale>
      );
    }
    if (kind === 'subagent' && part.child_session_id && onOpenChildSession) {
      nodes.push(
        <PressableScale
          key="child"
          testID="agent-tool-open-child"
          accessibilityRole="button"
          accessibilityLabel={t`Open the subagent's session`}
          onPress={handleOpenChild}
          style={styles.action}>
          <Text variant="caption" color={colors.accent} style={styles.actionText}>
            <Trans>Open session</Trans>
          </Text>
        </PressableScale>
      );
    }
    return nodes.length > 0 ? nodes : null;
  }, [
    kind,
    pending,
    detached,
    part.child_session_id,
    onRunInBackground,
    onOpenBackgroundTray,
    onOpenChildSession,
    handleOpenTray,
    handleOpenChild,
    colors,
    t,
  ]);

  // ---- title and caption -------------------------------------------------

  const { headerTitle, headerCaption } = useMemo(() => {
    if (kind === 'read' || kind === 'edit' || kind === 'write') {
      // The basename identifies the file; the *folder* is the quieter second
      // line. Handing the caption the whole path again printed the same long
      // name twice, truncated twice, in two directions.
      return { headerTitle: basename(target) || target, headerCaption: dirname(caption) };
    }
    if (kind === 'subagent') {
      return {
        headerTitle: child?.title || part.title || target,
        headerCaption: child?.caption ?? '',
      };
    }
    if (kind === 'skill') {
      // `metadata.name` is the skill; `input.id` is the file it lives in. The
      // header used to show the id, which named the wrong thing.
      const name = skillNameFromMetadata(part.metadata);
      return {
        headerTitle: name || target,
        headerCaption: skillDirectoryFromMetadata(part.metadata),
      };
    }
    if (kind === 'web') {
      // A fetch is identified by where it went: the host is the fact and the
      // path is which page of it. A whole URL in a clipped one-line header is
      // `https://docs.expo.d…/config` -- neither of them.
      const { host, path } = splitUrl(target);
      if (host) return { headerTitle: host, headerCaption: path };
      // A search: the query is the title, and there is no second line.
      return { headerTitle: part.title ?? target, headerCaption: '' };
    }
    return { headerTitle: part.title ?? target, headerCaption: caption };
  }, [kind, target, caption, part.title, part.metadata, child]);

  // ---- body --------------------------------------------------------------

  const body = useMemo(
    () =>
      renderToolBody({
        kind,
        part,
        input,
        target,
        outputText,
        outputTruncated: truncated,
        files,
        editFiles,
        patchSections,
        patchFiles,
        grepGroups,
        globGroups,
        questions,
        answers,
        subagentText: subagent?.text ?? '',
        subagentPrompt: subagent?.prompt ?? '',
        canOpenSession: Boolean(part.child_session_id && onOpenChildSession),
        writeContent,
        oldString,
        newString,
        markdownStyle,
        onPreviewImage,
        onOpenFile,
        onOpenFullDiff,
      }),
    [
      kind,
      part,
      input,
      target,
      outputText,
      truncated,
      files,
      editFiles,
      patchSections,
      patchFiles,
      grepGroups,
      globGroups,
      questions,
      answers,
      subagent,
      onOpenChildSession,
      writeContent,
      oldString,
      newString,
      markdownStyle,
      onPreviewImage,
      onOpenFile,
      onOpenFullDiff,
    ]
  );

  /**
   * The failure line, in this app's vocabulary where it is about this app.
   *
   * "The user declined this tool call" is the engine writing for its own
   * terminal, and a third word -- after the "Deny" on the button and the
   * "Denied" in the tray -- for one act. Everything else the engine says is
   * its own and is said as it was said.
   */
  const errorLine = part.error?.message
    ? isDeclinedByUser(part.error.message)
      ? t`Denied by you`
      : part.error.message
    : '';

  return (
    <EmbeddedTerminalToolBlock
      testID={`agent-tool-${part.id}`}
      toolName={
        sleepDuration !== undefined
          ? `${t`Wait`} · ${formatToolDuration(sleepDuration)}`
          : part.name === 'image_generation'
            ? t`Image`
            : child?.action
              ? i18n._(subagentActionWord[child.action])
              : part.name
      }
      kind={kind}
      taskSummary={
        muqun
          ? {
              title: muqunTitle,
              identity: '',
              statusLabel: i18n._(muqunStatusWord[muqun.status]),
              status: <MuqunToolState status={muqun.status} />,
              busy: muqun.status === 'calling',
            }
          : kind === 'subagent'
            ? {
                title:
                  (typeof input?.description === 'string' && input.description.trim()) ||
                  (typeof input?.prompt === 'string' && input.prompt.trim().split('\n')[0]) ||
                  headerCaption ||
                  headerTitle ||
                  part.name,
                identity: headerTitle,
                role:
                  childSession && childSession.asid === part.child_session_id
                    ? childSession.agent_role
                    : undefined,
                statusLabel: childStatusLabel,
                busy: childWorking,
                status: (
                  <View style={styles.taskState}>
                    <StatusDot
                      size={7}
                      filled
                      pulse={childWorking}
                      color={
                        child?.state === 'failed'
                          ? theme.colors.danger
                          : childWorking || child?.state === 'blocked'
                            ? theme.colors.warning
                            : theme.colors.textMuted
                      }
                    />
                    <Text
                      variant="caption"
                      color={theme.colors.textMuted}
                      style={[styles.actionText, styles.taskStateText]}>
                      {childStatusLabel}
                    </Text>
                  </View>
                ),
              }
            : undefined
      }
      title={
        muqun || sleepDuration !== undefined || (kind === 'shell' && headerTitle === target)
          ? undefined
          : headerTitle
      }
      headerAccessory={
        sleepDuration !== undefined && pending ? (
          <AgentSleepToolBody durationMs={sleepDuration} part={part} compact />
        ) : themeFile && onOpenFile ? (
          <PressableScale
            testID="agent-tool-preview-theme"
            accessibilityRole="button"
            accessibilityLabel={t`Preview theme ${basename(themeFile)}`}
            hitSlop={10}
            onPress={() => onOpenFile(toolFileForPath(themeFile))}
            style={[
              styles.themePreview,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
            ]}>
            <AppearanceIcon size={11} color={colors.accent} />
            <Text variant="caption" color={colors.accent} style={styles.actionText}>
              <Trans>Preview theme</Trans>
            </Text>
          </PressableScale>
        ) : undefined
      }
      caption={muqun ? undefined : headerCaption}
      status={!pending && resultFailed ? 'failed' : part.state}
      {...(durationMs === undefined ? {} : { durationMs })}
      truncated={truncated}
      {...(!muqun && errorLine ? { error: errorLine } : {})}
      background={detached}
      {...(kind === 'subagent' && part.child_session_id && onOpenChildSession
        ? { onOpenDetail: handleOpenChild }
        : onOpenDetail
          ? { onOpenDetail }
          : {})}
      onExpand={onExpand}
      chips={muqun ? undefined : chips}
      actions={actions}
      // Every rich result mounts only after disclosure, including images and diffs.
      preview={
        // While the input is still arriving there is no result to preview and
        // the arguments are the only thing there is to say.
        !muqun &&
        pending &&
        argumentLine &&
        sleepDuration === undefined &&
        !(kind === 'shell' && target) ? (
          <StreamingArguments text={argumentLine} />
        ) : kind === 'edit' || kind === 'patch' ? (
          body
        ) : hasFiles ? (
          <ToolFiles
            files={files}
            imageAssets={part.image_assets}
            imageAttachments={part.image_attachments}
            audioSessionId={audioSessionId}
            onPreviewImage={onPreviewImage}
            onOpenFile={onOpenFile}
          />
        ) : null
      }>
      {muqun ? (
        <AgentMuqunToolBody presentation={muqun} durationMs={durationMs} />
      ) : kind === 'edit' || kind === 'patch' ? null : (
        body
      )}
    </EmbeddedTerminalToolBlock>
  );
});

/** Small complete runs fit their content using the Files cell/code renderer.
 * Larger bodies keep an explicit non-scrolling viewport and a snapshot viewer:
 * no unbounded list or competing vertical gestures inside the transcript.
 */
const ReadFileBody = memo(function ReadFileBody({
  preview,
  markdownStyle,
  truncated,
}: {
  preview: Extract<ReturnType<typeof readFilePreview>, { type: 'file' }>;
  markdownStyle: MarkdownStyle;
  truncated: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  if (canInlineFileText(preview.file, preview.content)) {
    return (
      <FileTextBody
        file={preview.file}
        content={preview.content}
        markdownStyle={markdownStyle}
        testID="agent-read"
        layout="inline"
        showsHorizontalScrollIndicator={false}
      />
    );
  }
  return (
    <View style={styles.stretch}>
      <PressableScale
        testID="agent-read-preview"
        accessibilityRole="button"
        accessibilityLabel={t`Open in viewer`}
        onPress={() => setOpen(true)}>
        <View style={readStyles.viewport} pointerEvents="none">
          {open ? null : (
            <FileTextBody
              file={preview.file}
              content={preview.content}
              markdownStyle={markdownStyle}
              testID="agent-read"
              showsHorizontalScrollIndicator={false}
            />
          )}
        </View>
        <Text variant="caption" color={theme.colors.primary} style={readStyles.openLabel}>
          {t`Open in viewer`}
        </Text>
      </PressableScale>
      {open ? (
        <Modal
          visible
          transparent
          statusBarTranslucent
          navigationBarTranslucent
          animationType="fade"
          onRequestClose={() => setOpen(false)}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <View style={readStyles.fullscreen}>
              <SheetFrame tint="background" frosted>
                <View
                  style={[
                    readStyles.fullscreen,
                    {
                      paddingTop: insets.top,
                      paddingBottom: insets.bottom,
                      paddingLeft: insets.left,
                      paddingRight: insets.right,
                    },
                  ]}>
                  <View style={readStyles.header}>
                    <Text
                      variant="bodySmall"
                      weight="semibold"
                      numberOfLines={2}
                      style={readStyles.title}>
                      {preview.file.name}
                    </Text>
                    {truncated ? (
                      <Text variant="caption" color={theme.colors.warning}>
                        {t`Truncated`}
                      </Text>
                    ) : null}
                    <PressableScale
                      testID="agent-read-close-preview"
                      accessibilityRole="button"
                      accessibilityLabel={t`Close preview`}
                      onPress={() => setOpen(false)}
                      style={readStyles.close}>
                      <CloseIcon size={20} color={theme.colors.text} />
                    </PressableScale>
                  </View>
                  <FileTextBody
                    file={preview.file}
                    content={preview.content}
                    markdownStyle={markdownStyle}
                    testID="agent-read-full"
                    showsHorizontalScrollIndicator={false}
                  />
                </View>
              </SheetFrame>
            </View>
          </GestureHandlerRootView>
        </Modal>
      ) : null}
    </View>
  );
});

const readStyles = StyleSheet.create({
  viewport: { height: 280, overflow: 'hidden' },
  fullscreen: { flex: 1, minHeight: 0 },
  openLabel: { paddingHorizontal: 16, paddingVertical: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  title: { flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

function readTodoItems(input: Record<string, unknown> | null): { text: string; done: boolean }[] {
  const raw = input?.todos ?? input?.items;
  if (!Array.isArray(raw)) return [];
  const out: { text: string; done: boolean }[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ text: entry, done: false });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const text =
      typeof rec.content === 'string'
        ? rec.content
        : typeof rec.text === 'string'
          ? rec.text
          : undefined;
    if (!text) continue;
    out.push({ text, done: rec.status === 'completed' || rec.done === true });
  }
  return out;
}

interface ToolBodyArgs {
  kind: ToolKind;
  part: ToolPart;
  input: Record<string, unknown> | null;
  target: string;
  outputText: string;
  outputTruncated: boolean;
  files: readonly { uri: string; mime?: string; name?: string }[];
  editFiles: ReturnType<typeof editFilesFromMetadata>;
  patchSections: ReturnType<typeof parsePatchSections>;
  patchFiles: ReturnType<typeof diffFilesFromMetadata>;
  grepGroups: ReturnType<typeof groupGrepMatches>;
  globGroups: ReturnType<typeof groupPathsByDirectory>;
  questions: readonly ToolQuestion[];
  answers: readonly string[][];
  subagentText: string;
  subagentPrompt: string;
  canOpenSession: boolean;
  writeContent?: string;
  oldString?: string;
  newString?: string;
  markdownStyle: MarkdownStyle;
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  onOpenFullDiff?: (path?: string) => void;
}

/** One body per family. Nothing here fetches; everything is already in hand. */
function renderToolBody(args: ToolBodyArgs): React.ReactNode {
  const { kind, part, input, target, outputText, markdownStyle } = args;

  const sleepDuration = sleepDurationMs(part.name, input);
  if (sleepDuration !== undefined) {
    return (
      <>
        <AgentSleepToolBody durationMs={sleepDuration} part={part} />
        <GenericToolBody input={undefined} outputText={outputText} />
      </>
    );
  }

  switch (kind) {
    case 'shell':
      return (
        <>
          {target ? <ShellCommand command={target} /> : null}
          <OutputLines text={outputText} />
        </>
      );

    case 'read': {
      const preview = readFilePreview(outputText, target, args.files);
      if (preview.type === 'empty') return null;
      if (preview.type === 'output') return <OutputLines text={preview.text} />;
      return (
        <ReadFileBody
          preview={preview}
          markdownStyle={markdownStyle}
          truncated={args.outputTruncated}
        />
      );
    }

    case 'edit': {
      if (args.editFiles.length > 0) {
        return (
          <EditDiffs
            files={args.editFiles}
            {...(args.onOpenFullDiff ? { onOpenFullDiff: args.onOpenFullDiff } : {})}
          />
        );
      }
      // No `metadata.files`: an older engine, or a tool that answered without
      // one. The before and after are still a diff, just one we assemble.
      if (args.oldString || args.newString) {
        return (
          <PatchBody
            patch={syntheticPatch(target, args.oldString, args.newString)}
            {...(args.onOpenFullDiff ? { onOpenFullDiff: args.onOpenFullDiff } : {})}
          />
        );
      }
      return <OutputLines text={outputText} />;
    }

    case 'write':
      return args.writeContent ? (
        <CodeBody
          body={args.writeContent}
          language={fenceLanguageForPath(target)}
          markdownStyle={markdownStyle}
          {...viewerAction(target, args.onOpenFile)}
        />
      ) : (
        <OutputLines text={outputText} />
      );

    case 'patch':
      // What was applied, when the tool said: the same per-file rows an `edit`
      // draws, so two tools that changed the same file read the same way.
      if (args.patchFiles.length > 0) {
        return (
          <EditDiffs
            files={args.patchFiles}
            {...(args.onOpenFullDiff ? { onOpenFullDiff: args.onOpenFullDiff } : {})}
          />
        );
      }
      return args.patchSections.length > 0 ? (
        <>
          {args.patchSections.map((section) => (
            <View key={`${section.action}:${section.path}`} style={styles.stretch}>
              <PatchBody
                patch={section.patch}
                targetPath={section.path}
                {...(args.onOpenFullDiff ? { onOpenFullDiff: args.onOpenFullDiff } : {})}
              />
            </View>
          ))}
        </>
      ) : (
        <OutputLines text={outputText} />
      );

    case 'glob':
      return args.globGroups.length > 0 ? (
        <GlobFiles
          groups={args.globGroups}
          {...(args.onOpenFile ? { onOpenFile: args.onOpenFile } : {})}
        />
      ) : (
        <OutputLines text={outputText} />
      );

    case 'search':
      return <OutputLines text={outputText} />;

    case 'grep':
      return args.grepGroups.length > 0 ? (
        <GrepMatches groups={args.grepGroups} />
      ) : (
        <OutputLines text={outputText} />
      );

    case 'web':
      // Github flavor: a fetched page's markdown reliably has tables and task
      // lists in it, and commonmark draws neither.
      return outputText ? <WebResult markdown={outputText} markdownStyle={markdownStyle} /> : null;

    case 'subagent':
      if (args.subagentText) {
        return (
          <BoundedMarkdown
            markdown={args.subagentText}
            markdownStyle={markdownStyle}
            openLinks={false}
          />
        );
      }
      return (
        <SubagentActivityBody
          prompt={args.subagentPrompt}
          canOpenSession={args.canOpenSession}
          markdownStyle={markdownStyle}
        />
      );

    case 'skill': {
      const description =
        typeof input?.description === 'string' ? input.description : outputText || '';
      return description ? <SkillBody description={description} /> : null;
    }

    case 'question':
      // v2 asks through forms, and the form card is where the question is
      // answered -- a second copy of it in the timeline would be two places to
      // answer the same thing. What is left once it has been answered is a row
      // naming a question with no way to see what was asked or what was said,
      // so the card keeps a body: the questions, and what was picked in each.
      return (
        <QuestionBody questions={args.questions} answers={args.answers} fallback={outputText} />
      );

    case 'todo': {
      const items = readTodoItems(input);
      return items.length > 0 ? (
        <AgentTodoBlock items={items} />
      ) : (
        <GenericToolBody input={part.input} outputText={outputText} />
      );
    }

    case 'execute':
      return (
        <>
          {typeof input?.code === 'string' ? (
            <CodeBody body={input.code} language="javascript" markdownStyle={markdownStyle} />
          ) : null}
          <ExecuteCalls metadata={part.metadata} />
          <OutputLines text={outputText} />
        </>
      );

    default: {
      // Codex's picture brief is the `prompt` string. Print that string,
      // with its own line breaks.
      const prompt = imageGenerationPrompt(part.name, input);
      if (prompt) return <ImagePrompt text={prompt} />;
      // The structured image/path preview already represents image-view input.
      // Keep raw arguments in Details, while preserving returned text and errors.
      const imageView = part.name === 'image_view' || part.name === 'view_image';
      const hasImageViewPreview =
        imageView &&
        (args.files.length > 0 ||
          part.image_attachments?.some((uri) =>
            part.image_assets?.some((asset) => asset.src === uri && asset.mime.startsWith('image/'))
          ));
      return (
        <GenericToolBody
          input={hasImageViewPreview ? undefined : part.input}
          outputText={outputText}
        />
      );
    }
  }
}

function sleepDurationMs(name: string, input: Record<string, unknown> | null): number | undefined {
  const duration = input?.durationMs ?? input?.duration_ms;
  return name === 'sleep' &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration >= 0
    ? duration
    : undefined;
}

function imageGenerationPrompt(name: string, input: Record<string, unknown> | null): string {
  if (name !== 'image_generation') return '';
  const prompt = input?.prompt;
  return typeof prompt === 'string' ? prompt.trim() : '';
}

/**
 * The same file, in the viewer that is built to scroll it.
 *
 * Offered only for a real path: a `read` of a URL or of a relative name the
 * gateway resolved elsewhere has nothing the asset viewer could open.
 */
function viewerAction(
  target: string,
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void
): { onOpenInViewer?: () => void } {
  if (!onOpenFile || !target.startsWith('/')) return {};
  return { onOpenInViewer: () => onOpenFile(toolFileForPath(target)) };
}

/** A `+`/`-` patch made from a before and an after, when no real one came. */
function syntheticPatch(path: string, oldString?: string, newString?: string): string {
  const lines: string[] = [`@@ ${path} @@`];
  // No `.filter()` that keeps everything: the predicate was
  // `index < all.length || true`, which is `true`, and it read as though some
  // rule were being applied.
  if (oldString) for (const line of oldString.split('\n')) lines.push(`-${line}`);
  if (newString) for (const line of newString.split('\n')) lines.push(`+${line}`);
  return lines.join('\n');
}

/**
 * The arguments of a call that has not run yet, as they arrive.
 *
 * Monospace and wrapping, because it is a payload being written rather than a
 * sentence: the header's one clipped line cannot show a command taking shape,
 * and two lines of it can.
 */
const StreamingArguments = memo(function StreamingArguments({ text }: { text: string }) {
  const colors = usePaneChatColors();
  const mono = useMonoFontFamily();
  return (
    <Text numberOfLines={2} style={[styles.mono, { color: colors.muted, fontFamily: mono }]}>
      {text}
    </Text>
  );
});

const ShellCommand = memo(function ShellCommand({ command }: { command: string }) {
  const colors = usePaneChatColors();
  const mono = useMonoFontFamily();
  return (
    <Text
      selectable
      style={[styles.mono, styles.command, { color: colors.accent, fontFamily: mono }]}>
      {command}
    </Text>
  );
});

const EditDiffs = memo(function EditDiffs({
  files,
  onOpenFullDiff,
}: {
  files: ReturnType<typeof editFilesFromMetadata>;
  onOpenFullDiff?: (path?: string) => void;
}) {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const colors = usePaneChatColors();
  const [expandedOrder, setExpandedOrder] = useState<readonly string[]>(() =>
    files.length === 1 ? [files[0].path] : []
  );
  const expanded = useMemo(() => new Set(expandedOrder), [expandedOrder]);
  const rows = useMemo(() => diffRowsFromPatches(files, expanded), [files, expanded]);
  const toggle = useCallback((path: string) => {
    setExpandedOrder((order) =>
      order.includes(path) ? order.filter((entry) => entry !== path) : [...order, path]
    );
  }, []);

  return (
    <InlineDiffRows
      rows={rows}
      colors={colors}
      gutterFill={theme.colors.surface}
      headerFill={surfaceBackground(theme.colors.surface)}
      onToggleFile={toggle}
      onGrid
      {...(onOpenFullDiff ? { onOpenFullDiff } : {})}
    />
  );
});

/** Directories a glob card lists, and files inside each, before it stops. */
const GLOB_GROUP_MAX = 8;
const GLOB_FILE_MAX = 12;

/**
 * What a `glob` found, as files rather than as a wall of paths.
 *
 * The tool answers with one absolute path per line. Drawn as it comes, every
 * row repeats the same long prefix and the part that differs -- the file name
 * -- is off the right-hand edge of a phone. The folder is a heading said once,
 * each row is a name, and a row opens the file in the viewer a `read` opens:
 * finding a file and then having to ask a second tool to see it was the whole
 * of the interaction this card was missing.
 */
const GlobFiles = memo(function GlobFiles({
  groups,
  onOpenFile,
}: {
  groups: ReturnType<typeof groupPathsByDirectory>;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const mono = useMonoFontFamily();
  const shown = groups.slice(0, GLOB_GROUP_MAX);
  return (
    <View style={styles.stretch}>
      {shown.map((group) => (
        <View key={group.directory} style={styles.globGroup}>
          <Text
            variant="caption"
            weight="semibold"
            numberOfLines={1}
            // A path says what it is in its last segment: every result of one
            // glob shares a prefix, so the head is what can be dropped.
            ellipsizeMode="head"
            color={theme.colors.textSubtle}
            style={[styles.globDirectory, { fontFamily: mono }]}>
            {group.directory || '/'}
          </Text>
          {group.files.slice(0, GLOB_FILE_MAX).map((name) => {
            const path = group.directory ? `${group.directory}/${name}` : name;
            return (
              <PressableScale
                key={path}
                testID="agent-tool-glob-file"
                accessibilityRole="button"
                accessibilityLabel={name}
                disabled={!onOpenFile}
                onPress={() => onOpenFile?.(toolFileForPath(path))}
                style={styles.globRow}>
                <DocumentIcon size={11} color={colors.subtle} />
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={[
                    styles.mono,
                    styles.globName,
                    { color: theme.colors.text, fontFamily: mono },
                  ]}>
                  {name}
                </Text>
              </PressableScale>
            );
          })}
          {group.files.length > GLOB_FILE_MAX ? (
            <Text variant="caption" color={colors.subtle} style={styles.globMore}>
              {`… ${group.files.length - GLOB_FILE_MAX}`}
            </Text>
          ) : null}
        </View>
      ))}
      {groups.length > shown.length ? (
        <Text variant="caption" color={colors.subtle} style={styles.globMore}>
          {`… ${groups.length - shown.length}`}
        </Text>
      ) : null}
    </View>
  );
});

const GrepMatches = memo(function GrepMatches({
  groups,
}: {
  groups: ReturnType<typeof groupGrepMatches>;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const mono = useMonoFontFamily();
  // Bounded on both axes: a repository-wide grep is thousands of matches, and
  // a timeline cell is not a scroll container.
  const shown = groups.slice(0, 12);
  return (
    <View style={styles.stretch}>
      {shown.map((group) => (
        <View key={group.file} style={styles.grepGroup}>
          <Text
            variant="caption"
            weight="semibold"
            numberOfLines={1}
            ellipsizeMode="head"
            color={theme.colors.text}
            style={styles.grepFile}>
            {group.file}
          </Text>
          {group.lines.slice(0, 8).map((match, index) => (
            <View key={`${group.file}:${match.line ?? index}`} style={styles.grepLine}>
              <Text style={[styles.grepNumber, { color: colors.subtle, fontFamily: mono }]}>
                {match.line ?? ''}
              </Text>
              <Text
                numberOfLines={1}
                selectable
                style={[styles.mono, { color: colors.muted, fontFamily: mono }]}>
                {match.text}
              </Text>
            </View>
          ))}
          {group.lines.length > 8 ? (
            <Text variant="caption" color={colors.subtle} style={styles.grepMore}>
              {`… ${group.lines.length - 8}`}
            </Text>
          ) : null}
        </View>
      ))}
      {groups.length > shown.length ? (
        <Text variant="caption" color={colors.subtle} style={styles.grepMore}>
          {`… ${groups.length - shown.length}`}
        </Text>
      ) : null}
    </View>
  );
});

const WebResult = memo(function WebResult({
  markdown,
  markdownStyle,
}: {
  markdown: string;
  markdownStyle: MarkdownStyle;
}) {
  // Github flavor: a fetched page's markdown reliably has tables and task
  // lists in it, and commonmark draws neither.
  return <BoundedMarkdown markdown={markdown} markdownStyle={markdownStyle} flavor="github" />;
});

/**
 * What was asked, and which of the offered answers came back.
 *
 * The tool asks with `input.questions[]` -- a short `header`, the question
 * itself, and the options it will accept -- and answers in
 * `metadata.answers[i]`, one list per question. The card used to read
 * `input.question` and `input.prompt`, keys this tool has never sent, so a
 * question row in the transcript said nothing at all.
 *
 * The interactive form card is where a live question is answered; this is the
 * record of one that was.
 */
const QuestionBody = memo(function QuestionBody({
  questions,
  answers,
  fallback,
}: {
  questions: readonly ToolQuestion[];
  answers: readonly string[][];
  /** The engine's own sentence about what was answered, for a card with no `questions[]`. */
  fallback: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const colors = usePaneChatColors();
  // The question is the agent's own words and is content; everything else here
  // is a label naming a choice.
  const askedStyle = useCompactMarkdownStyle('body');
  const answeredStyle = useCompactMarkdownStyle('muted');

  if (questions.length === 0) {
    return fallback ? (
      <BoundedMarkdown markdown={fallback} markdownStyle={answeredStyle} openLinks={false} />
    ) : null;
  }

  return (
    <View style={styles.stretch}>
      {questions.slice(0, QUESTION_MAX).map((question, index) => {
        const picked = answers[index] ?? [];
        // An answer the option list does not hold: a free-text reply, or an
        // engine that answered with something it never offered.
        const offered = new Set(question.options.map((option) => option.label));
        const unlisted = picked.filter((answer) => !offered.has(answer)).join(' · ');
        return (
          <View key={`${index}:${question.header || question.question}`} style={styles.questionRow}>
            {question.header || question.multiple ? (
              <View style={styles.questionHeaderLine}>
                {question.header ? (
                  <Text
                    variant="caption"
                    weight="semibold"
                    color={theme.colors.text}
                    style={styles.questionHeader}>
                    {question.header}
                  </Text>
                ) : null}
                {/* Whether the reader was allowed to pick more than one, which
                    is what makes several marked options a single answer. */}
                {question.multiple ? (
                  <Text
                    variant="caption"
                    color={theme.colors.textSubtle}
                    style={styles.questionHeader}>
                    {t`Several answers`}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {question.question ? (
              <BoundedMarkdown
                markdown={question.question}
                markdownStyle={askedStyle}
                openLinks={false}
              />
            ) : null}
            <View style={styles.optionsWrap}>
              {question.options.slice(0, QUESTION_OPTION_MAX).map((option) => {
                // An answered question marks what was chosen rather than
                // repeating it underneath: the options are already the list.
                const chosen = picked.includes(option.label);
                return (
                  <View
                    key={option.label}
                    style={[
                      styles.optionPill,
                      option.description ? styles.optionWithDescription : null,
                      {
                        borderRadius: profile.chrome.control,
                        borderColor: chosen ? colors.accent : colors.border,
                        backgroundColor: chosen ? withAlpha(colors.accent, 0.12) : 'transparent',
                      },
                    ]}>
                    {chosen ? <DoneIcon size={11} color={colors.accent} /> : null}
                    <View style={styles.optionCopy}>
                      <Text
                        variant="caption"
                        weight={chosen ? 'semibold' : 'regular'}
                        color={chosen ? colors.accent : theme.colors.text}
                        style={styles.optionLabel}>
                        {plainFromMarkdown(option.label)}
                      </Text>
                      {option.description ? (
                        <Text
                          variant="caption"
                          color={theme.colors.textSubtle}
                          style={styles.optionDescription}>
                          {plainFromMarkdown(option.description)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
            {unlisted ? (
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                style={styles.questionExtraAnswer}>
                {unlisted}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
});

/**
 * What the skill says it is.
 *
 * A skill's text is a document -- OpenCode's own skills lead with a heading
 * and a fenced example -- and it was drawn as one unbroken caption.
 */
const SkillBody = memo(function SkillBody({ description }: { description: string }) {
  const markdownStyle = useCompactMarkdownStyle('muted');
  return <BoundedMarkdown markdown={description} markdownStyle={markdownStyle} openLinks={false} />;
});

/**
 * What the sandboxed code called, and how each call went.
 *
 * `metadata.toolCalls` carries `{tool, status, input}` per entry and the card
 * kept only the names, joined into one grey line: a `read` that failed inside
 * the sandbox and a `read` that worked read identically. A row each, with the
 * same status dot the rest of the transcript uses -- the progress event
 * streams this list while the code runs, so `running` is a state the reader
 * actually sees.
 */
const ExecuteCalls = memo(function ExecuteCalls({
  metadata,
}: {
  metadata: Record<string, unknown>;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const mono = useMonoFontFamily();
  const calls = useMemo(() => executeToolCalls(metadata), [metadata]);
  if (calls.length === 0) return null;
  return (
    <View style={styles.stretch}>
      {calls.slice(0, EXECUTE_CALL_MAX).map((call, index) => (
        <View key={`${index}:${call.name}`} style={styles.callRow}>
          <StatusDot
            size={6}
            filled
            pulse={call.status === 'running'}
            color={
              call.status === 'error'
                ? theme.colors.danger
                : call.status === 'running'
                  ? theme.colors.warning
                  : theme.colors.success
            }
          />
          <Text
            variant="caption"
            weight="semibold"
            color={call.status === 'error' ? theme.colors.danger : theme.colors.text}
            style={styles.callName}>
            {call.name}
          </Text>
          {call.input ? (
            <Text
              numberOfLines={1}
              style={[styles.mono, styles.callInput, { color: colors.subtle, fontFamily: mono }]}>
              {call.input}
            </Text>
          ) : null}
        </View>
      ))}
      {calls.length > EXECUTE_CALL_MAX ? (
        <Text variant="caption" color={colors.subtle} style={styles.callMore}>
          {`… ${calls.length - EXECUTE_CALL_MAX}`}
        </Text>
      ) : null}
    </View>
  );
});

/** Calls a card draws before it says how many more there were. */
const EXECUTE_CALL_MAX = 12;

/** The picture brief, as the sentences Codex wrote. */
const ImagePrompt = memo(function ImagePrompt({ text }: { text: string }) {
  const theme = useThemeTokens();
  return (
    <Text selectable variant="bodySmall" color={theme.colors.text}>
      {text}
    </Text>
  );
});

/** A child activity is not a returned transcript or a generic tool payload. */
function SubagentActivityBody({
  prompt,
  canOpenSession,
  markdownStyle,
}: {
  prompt: string;
  canOpenSession: boolean;
  markdownStyle: MarkdownStyle;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <View testID="agent-subagent-activity-body" style={styles.stretch}>
      {prompt ? (
        <>
          <Text variant="caption" color={theme.colors.textMuted}>{t`Prompt`}</Text>
          <BoundedMarkdown markdown={prompt} markdownStyle={markdownStyle} openLinks={false} />
        </>
      ) : null}
      <Text variant="caption" color={theme.colors.textMuted}>
        {canOpenSession
          ? t`This activity has no result attached. Open session to read the conversation.`
          : t`This activity has no result attached.`}
      </Text>
    </View>
  );
}

/** Unknown tools retain their bounded readable arguments and returned text. */
const GenericToolBody = memo(function GenericToolBody({
  input,
  outputText,
}: {
  input: unknown;
  outputText: string;
}) {
  // JSON is a language the renderer has a grammar for, so the payload is read
  // in the same highlighted fence a `read` of a file is, rather than as one
  // grey monospace wall.
  const markdownStyle = usePaneChatMarkdownStyle();
  const proseStyle = useCompactMarkdownStyle('body');
  const pretty = useMemo(() => toolInputJson(input), [input]);
  // An MCP server answers with whatever it likes: one returns a written
  // summary, the next returns a log. A heading, a list, a table or a backtick
  // is somebody writing markdown on purpose and is read as such; anything else
  // stays monospace, where its own alignment survives.
  const prose = hasMarkdownMarks(outputText);
  return (
    <>
      {pretty ? (
        <CodeBody body={pretty.text} language="json" markdownStyle={markdownStyle} />
      ) : null}
      {prose ? (
        <BoundedMarkdown markdown={outputText} markdownStyle={proseStyle} openLinks={false} />
      ) : (
        <OutputLines text={outputText} />
      )}
    </>
  );
});

const styles = StyleSheet.create({
  stretch: {
    alignSelf: 'stretch',
  },
  /**
   * Everything about a literal except which face draws it.
   *
   * The family used to be the string `'monospace'` right here, and that is the
   * one thing this style could not state: `'monospace'` is Android's generic
   * family and on iOS resolves to nothing in particular, so a reader who had
   * installed their own mono face in Settings > Font watched the markdown
   * fences and the diff change over while the tool cards -- a shell's output,
   * a grep hit, the arguments of a call still being written -- stayed on the
   * platform's. A `StyleSheet.create` object cannot call a hook, so each of
   * the six components below merges `useMonoFontFamily()` in at its own render
   * site and this keeps the metrics.
   */
  mono: {
    fontSize: AGENT_TYPE.meta.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
  command: {
    fontWeight: '600',
  },
  chipText: {
    fontSize: AGENT_TYPE.micro.size,
    fontVariant: ['tabular-nums'],
  },
  moreChip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderCurve: 'continuous',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    minWidth: 44,
    maxWidth: '100%',
    flexShrink: 1,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  themePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  actionText: {
    fontSize: AGENT_TYPE.micro.size,
    fontWeight: '600',
    flexShrink: 1,
  },
  taskState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  taskStateText: {
    flexShrink: 1,
  },
  fileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fileThumbWrap: {
    maxWidth: '100%',
    minWidth: 44,
    minHeight: 44,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  fileThumb: {
    width: 140,
    height: 96,
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 220,
  },
  fileChipName: {
    fontSize: AGENT_TYPE.meta.size,
    flexShrink: 1,
  },
  globGroup: {
    gap: 1,
    marginBottom: 4,
  },
  // A directory is a path, read segment by segment; same slot as `mono` above
  // and merged in the same way.
  globDirectory: {
    fontSize: AGENT_TYPE.micro.size,
  },
  globRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 22,
  },
  globName: {
    flexShrink: 1,
  },
  globMore: {
    fontSize: AGENT_TYPE.micro.size,
  },
  grepGroup: {
    gap: 1,
    marginBottom: 4,
  },
  grepFile: {
    fontSize: AGENT_TYPE.micro.size,
  },
  grepLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // The line number column, whose whole job is to be a fixed width of digits
  // beside the line it points at; the family comes from the mono slot at the
  // render site.
  grepNumber: {
    fontSize: AGENT_TYPE.micro.size,
    width: 34,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  grepMore: {
    fontSize: AGENT_TYPE.micro.size,
  },
  questionRow: {
    alignSelf: 'stretch',
    gap: 3,
    marginBottom: 6,
  },
  questionHeaderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  questionHeader: {
    fontSize: AGENT_TYPE.micro.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  /** The same pill the form card offers, with nothing left to press. */
  optionPill: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  optionWithDescription: {
    width: '100%',
  },
  optionCopy: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  optionLabel: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
  },
  optionDescription: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
  },
  questionExtraAnswer: {
    fontSize: AGENT_TYPE.micro.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 18,
  },
  callName: {
    fontSize: AGENT_TYPE.micro.size,
  },
  callInput: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
  },
  callMore: {
    fontSize: AGENT_TYPE.micro.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
});
