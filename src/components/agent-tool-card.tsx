import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { FileText, GitFork, Play } from 'lucide-react-native';
import { Image } from 'expo-image';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import { PressableScale } from '@/components/pressable-scale';
import { BoundedMarkdown, TruncationFooter } from '@/components/bounded-markdown';
import { StatusDot } from '@/components/status-dot';
import { AgentTodoBlock } from '@/components/agent-todo-block';
import {
  EmbeddedTerminalToolBlock,
  isToolPending,
} from '@/components/embedded-terminal-tool-block';
import { InlineDiffRows } from '@/components/diff-rows';
import { usePaneChatColors, usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { markdownPaletteKey } from '@/lib/markdown-palette';
import { TOOL_BODY_MAX_LINES, capToolBody } from '@/lib/markdown-cap';
import { diffRowsForFence, diffRowsFromPatches, diffTotals } from '@/lib/agent-diff-rows';
import {
  basename,
  capLines,
  classifyTool,
  editFilesFromMetadata,
  executeToolCalls,
  extractCaption,
  extractTarget,
  fenceLanguageForPath,
  fencedCode,
  filesFromContent,
  groupGrepMatches,
  parsePatchSections,
  parseToolOutput,
  prettyJson,
  resultCountFromMetadata,
  shellExitFromMetadata,
  stripReadLineNumbers,
  stripSubagentEnvelope,
  subagentStatusFromMetadata,
  textFromContent,
  toolInputRecord,
  type ToolKind,
} from '@/lib/agent-tool-output';
import {
  isBusyStatus,
  toolDurationMs,
  type AgentRunStatus,
  type ToolPart,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';

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
  part: ToolPart;
  markdownStyle: MarkdownStyle;
  /** The live status of the session a subagent started, if it is being watched. */
  childStatus?: AgentRunStatus;
  onOpenChildSession?: (asid: string) => void;
  /** `POST …/background`, offered while a foreground tool is still running. */
  onRunInBackground?: () => void;
  onOpenBackgroundTray?: () => void;
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  /** The virtualised changes viewer, for a patch too big to draw in a cell. */
  onOpenFullDiff?: () => void;
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
          note={t`${capped.hidden} more lines`}
          onShowMore={() => setBudget((prev) => prev + TOOL_BODY_MAX_LINES)}
          showMoreLabel={t`Show more`}
          extra={
            onOpenInViewer ? (
              <PressableScale
                testID="agent-tool-open-viewer"
                accessibilityRole="button"
                accessibilityLabel={t`Open in viewer`}
                onPress={onOpenInViewer}
                style={[styles.moreChip, { borderColor: colors.border }]}>
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
  const colors = usePaneChatColors();
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
      <Text selectable style={[styles.mono, { color: theme.colors.textMuted }]}>
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
          style={[styles.moreChip, { borderColor: colors.border }]}>
          <Text variant="caption" color={colors.accent}>
            {t`${capped.hidden} more lines`}
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

/** The files a tool returned: images inline, everything else as a chip. */
const ToolFiles = memo(function ToolFiles({
  files,
  onPreviewImage,
  onOpenFile,
}: {
  files: readonly { uri: string; mime?: string; name?: string }[];
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const raised = useTranscriptPlate('raised');

  return (
    <View style={styles.fileRow}>
      {files.map((file) => {
        if (isImageFile(file)) {
          return (
            <PressableScale
              key={file.uri}
              accessibilityRole="imagebutton"
              accessibilityLabel={file.name ?? t`Open image`}
              onPress={() => onPreviewImage?.(file.uri)}
              style={styles.fileThumbWrap}>
              <Image source={{ uri: file.uri }} style={styles.fileThumb} contentFit="cover" />
            </PressableScale>
          );
        }
        return (
          <PressableScale
            key={file.uri}
            accessibilityRole="button"
            accessibilityLabel={t`Open ${file.name ?? basename(file.uri)}`}
            onPress={() => onOpenFile?.(file)}
            style={[styles.fileChip, raised]}>
            <FileText size={13} color={theme.colors.primary} />
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
  onOpenFullDiff,
}: {
  patch: string;
  onOpenFullDiff?: () => void;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const rows = useMemo(() => diffRowsForFence(patch), [patch]);
  if (rows.length === 0) return null;
  return (
    <InlineDiffRows
      rows={rows}
      colors={colors}
      gutterFill={theme.colors.surface}
      headerFill={theme.colors.surface}
      {...(onOpenFullDiff ? { onOpenFullDiff } : {})}
    />
  );
});

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export const AgentToolCard = memo(function AgentToolCard({
  part,
  childStatus,
  onOpenChildSession,
  onRunInBackground,
  onOpenBackgroundTray,
  onPreviewImage,
  onOpenFile,
  onOpenFullDiff,
}: AgentToolCardProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  // Read from the theme here, not from a prop: the timeline's memoised cells
  // skip re-renders the list cannot see, and a style handed down through
  // render props would stay the palette the cell was born with. A hook
  // subscribes this card to the theme itself, so a colour-mode switch reaches
  // it whatever the list decides.
  const markdownStyle = usePaneChatMarkdownStyle();
  const colors = usePaneChatColors();

  const kind = useMemo(() => classifyTool(part.name), [part.name]);
  const input = useMemo(() => toolInputRecord(part.input), [part.input]);
  const target = useMemo(() => extractTarget(kind, part.input), [kind, part.input]);
  const caption = useMemo(() => extractCaption(kind, part.input), [kind, part.input]);

  // `content` is the real result; `output` is the same text flattened and is
  // what an older gateway sends on its own.
  const outputText = useMemo(() => {
    const fromContent = textFromContent(part.content);
    return fromContent || parseToolOutput(part.output).stdout;
  }, [part.content, part.output]);
  const files = useMemo(() => filesFromContent(part.content), [part.content]);
  const parsed = useMemo(() => parseToolOutput(part.output), [part.output]);

  const pending = isToolPending(part.state);
  const durationMs = toolDurationMs(part.time);
  const truncated = part.truncated === true || parsed.truncated;

  const handleOpenChild = useCallback(() => {
    const childId = part.child_session_id;
    if (childId) onOpenChildSession?.(childId);
  }, [part.child_session_id, onOpenChildSession]);

  // ---- per-family reading ------------------------------------------------

  const editFiles = useMemo(
    () => (kind === 'edit' ? editFilesFromMetadata(part.metadata) : []),
    [kind, part.metadata]
  );
  const patchSections = useMemo(() => {
    if (kind !== 'patch') return [];
    const text = input ? (input.patchText ?? input.patch_text ?? input.patch) : undefined;
    return typeof text === 'string' ? parsePatchSections(text) : [];
  }, [kind, input]);
  const grepGroups = useMemo(
    () => (kind === 'grep' ? groupGrepMatches(outputText) : []),
    [kind, outputText]
  );
  const subagent = useMemo(
    () => (kind === 'subagent' ? stripSubagentEnvelope(outputText) : null),
    [kind, outputText]
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

  // ---- chips -------------------------------------------------------------

  const chips = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const exit = shellExitFromMetadata(part.metadata) ?? parsed.exitCode;
    if (kind === 'shell' && exit !== undefined) {
      nodes.push(
        <Chip key="exit" text={`exit ${exit}`} color={exit === 0 ? colors.added : colors.removed} />
      );
    }
    if (kind === 'edit' || kind === 'patch') {
      const totals =
        editFiles.length > 0
          ? diffTotals(editFiles)
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
      nodes.push(<Chip key="count" text={t`${count} results`} color={theme.colors.textMuted} />);
    }
    if (kind === 'subagent') {
      const status = subagentStatusFromMetadata(part.metadata) ?? subagent?.state;
      if (status) {
        nodes.push(<Chip key="sub" text={status} color={theme.colors.textMuted} />);
      }
    }
    return nodes.length > 0 ? nodes : null;
  }, [
    kind,
    part.metadata,
    parsed.exitCode,
    colors,
    editFiles,
    newString,
    oldString,
    writeContent,
    subagent,
    theme.colors.textMuted,
    t,
  ]);

  // ---- actions -----------------------------------------------------------

  const actions = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    // `ctrl+b` in the TUI: detach the foreground tools blocking the loop. The
    // shell keeps running and stays readable in the tray.
    if (kind === 'shell' && pending && !part.background && onRunInBackground) {
      nodes.push(
        <PressableScale
          key="bg"
          testID="agent-tool-run-in-background"
          accessibilityRole="button"
          accessibilityLabel={t`Run in background`}
          onPress={onRunInBackground}
          style={[styles.action, { borderColor: colors.border }]}>
          <Play size={11} color={colors.accent} />
          <Text variant="caption" color={colors.accent} style={styles.actionText}>
            <Trans>Run in background</Trans>
          </Text>
        </PressableScale>
      );
    }
    if (part.background && onOpenBackgroundTray) {
      nodes.push(
        <PressableScale
          key="tray"
          testID="agent-tool-open-tray"
          accessibilityRole="button"
          accessibilityLabel={t`Open background tasks`}
          onPress={onOpenBackgroundTray}
          style={[styles.action, { borderColor: colors.border }]}>
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
          style={[styles.action, { borderColor: colors.border }]}>
          {/* The child's own status, not the tool's: a subagent can still be
              working after the call that started it has returned. */}
          <StatusDot
            size={7}
            filled
            pulse={isBusyStatus(childStatus)}
            color={
              childStatus === 'failed'
                ? theme.colors.danger
                : isBusyStatus(childStatus)
                  ? theme.colors.warning
                  : theme.colors.success
            }
          />
          <GitFork size={11} color={colors.accent} />
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
    part.background,
    part.child_session_id,
    onRunInBackground,
    onOpenBackgroundTray,
    onOpenChildSession,
    handleOpenChild,
    childStatus,
    colors,
    theme.colors,
    t,
  ]);

  // ---- title and caption -------------------------------------------------

  const { headerTitle, headerCaption } = useMemo(() => {
    if (kind === 'read' || kind === 'edit' || kind === 'write') {
      // The basename identifies the file; the path is the quieter second line.
      return { headerTitle: basename(target) || target, headerCaption: caption };
    }
    if (kind === 'subagent') {
      const agent = typeof input?.agent === 'string' ? input.agent : undefined;
      return { headerTitle: agent ? `${agent} · ${target}` : target, headerCaption: '' };
    }
    return { headerTitle: part.title ?? target, headerCaption: caption };
  }, [kind, target, caption, part.title, input]);

  // ---- body --------------------------------------------------------------

  const body = useMemo(
    () =>
      renderToolBody({
        kind,
        part,
        input,
        target,
        outputText,
        files,
        editFiles,
        patchSections,
        grepGroups,
        subagentText: subagent?.text ?? '',
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
      files,
      editFiles,
      patchSections,
      grepGroups,
      subagent,
      writeContent,
      oldString,
      newString,
      markdownStyle,
      onPreviewImage,
      onOpenFile,
      onOpenFullDiff,
    ]
  );

  // A todo list is a checklist, not a tool row: OpenCode's own UI draws it
  // that way and there is nothing about the call worth a header.
  if (kind === 'todo') {
    const items = readTodoItems(input);
    if (items.length > 0) return <AgentTodoBlock items={items} />;
  }

  return (
    <EmbeddedTerminalToolBlock
      testID={`agent-tool-${part.id}`}
      toolName={part.name}
      kind={kind}
      title={headerTitle}
      caption={headerCaption}
      status={part.state}
      {...(durationMs === undefined ? {} : { durationMs })}
      truncated={truncated}
      {...(part.error?.message ? { error: part.error.message } : {})}
      background={part.background === true}
      chips={chips}
      actions={actions}
      // An edit's diff and a read's images are the content, not a detail
      // behind an expand.
      preview={
        kind === 'edit' || kind === 'patch' ? (
          body
        ) : files.length > 0 ? (
          <ToolFiles files={files} onPreviewImage={onPreviewImage} onOpenFile={onOpenFile} />
        ) : null
      }>
      {kind === 'edit' || kind === 'patch' ? null : body}
    </EmbeddedTerminalToolBlock>
  );
});

/** Drops `data:…;base64,…` runs and bare base64 walls from a text body. */
function stripDataUris(text: string): string {
  return text
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, '')
    .split('\n')
    .filter((line) => !(line.length > 120 && /^[A-Za-z0-9+/=]+$/.test(line.trim())))
    .join('\n')
    .trim();
}

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
  files: readonly { uri: string; mime?: string; name?: string }[];
  editFiles: ReturnType<typeof editFilesFromMetadata>;
  patchSections: ReturnType<typeof parsePatchSections>;
  grepGroups: ReturnType<typeof groupGrepMatches>;
  subagentText: string;
  writeContent?: string;
  oldString?: string;
  newString?: string;
  markdownStyle: MarkdownStyle;
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  onOpenFullDiff?: () => void;
}

/** One body per family. Nothing here fetches; everything is already in hand. */
function renderToolBody(args: ToolBodyArgs): React.ReactNode {
  const { kind, part, input, target, outputText, markdownStyle } = args;

  switch (kind) {
    case 'shell':
      return (
        <>
          {target ? <ShellCommand command={target} /> : null}
          <OutputLines text={outputText} />
        </>
      );

    case 'read': {
      const language = fenceLanguageForPath(target);
      // An image read comes back as a file item (drawn above) and, on some
      // engines, the same bytes again as a data URI in the text. The picture
      // is the content; the base64 never is.
      const body = stripDataUris(stripReadLineNumbers(outputText));
      if (!body) return null;
      return (
        <CodeBody
          body={body}
          language={language}
          markdownStyle={markdownStyle}
          {...viewerAction(target, args.onOpenFile)}
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
      return args.patchSections.length > 0 ? (
        <>
          {args.patchSections.map((section) => (
            <View key={`${section.action}:${section.path}`} style={styles.stretch}>
              <PatchBody
                patch={section.patch}
                {...(args.onOpenFullDiff ? { onOpenFullDiff: args.onOpenFullDiff } : {})}
              />
            </View>
          ))}
        </>
      ) : (
        <OutputLines text={outputText} />
      );

    case 'glob':
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
      return args.subagentText ? (
        <BoundedMarkdown
          markdown={args.subagentText}
          markdownStyle={markdownStyle}
          openLinks={false}
        />
      ) : null;

    case 'skill': {
      const description =
        typeof input?.description === 'string' ? input.description : outputText || '';
      return description ? <SkillBody description={description} /> : null;
    }

    case 'question':
      // v2 asks through forms; the form card is the question. A second copy of
      // it in the timeline would be two places to answer the same thing.
      return null;

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

    default:
      return <GenericToolBody input={part.input} outputText={outputText} />;
  }
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
  const name = basename(target);
  const mime = /\.mdx?$/i.test(target) ? 'text/markdown' : 'text/plain';
  return { onOpenInViewer: () => onOpenFile({ uri: target, mime, name }) };
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

const ShellCommand = memo(function ShellCommand({ command }: { command: string }) {
  const colors = usePaneChatColors();
  return (
    <Text selectable style={[styles.mono, styles.command, { color: colors.accent }]}>
      {command}
    </Text>
  );
});

const EditDiffs = memo(function EditDiffs({
  files,
  onOpenFullDiff,
}: {
  files: ReturnType<typeof editFilesFromMetadata>;
  onOpenFullDiff?: () => void;
}) {
  const theme = useThemeTokens();
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
      headerFill={theme.colors.surface}
      onToggleFile={toggle}
      {...(onOpenFullDiff ? { onOpenFullDiff } : {})}
    />
  );
});

const GrepMatches = memo(function GrepMatches({
  groups,
}: {
  groups: ReturnType<typeof groupGrepMatches>;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
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
              <Text style={[styles.grepNumber, { color: colors.subtle }]}>{match.line ?? ''}</Text>
              <Text numberOfLines={1} selectable style={[styles.mono, { color: colors.muted }]}>
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

const SkillBody = memo(function SkillBody({ description }: { description: string }) {
  const theme = useThemeTokens();
  return (
    <Text variant="caption" selectable color={theme.colors.textMuted} style={styles.skillText}>
      {description}
    </Text>
  );
});

const ExecuteCalls = memo(function ExecuteCalls({
  metadata,
}: {
  metadata: Record<string, unknown>;
}) {
  const colors = usePaneChatColors();
  const calls = useMemo(() => executeToolCalls(metadata), [metadata]);
  if (calls.length === 0) return null;
  return (
    <Text variant="caption" color={colors.subtle} style={styles.skillText}>
      {calls.join(' · ')}
    </Text>
  );
});

/**
 * A tool nothing in this build recognises.
 *
 * Its input as readable JSON -- depth-capped and byte-capped, so an MCP result
 * with a base64 image in it cannot put megabytes into one `<Text>` -- and its
 * text result under it. Never `JSON.stringify` of the whole payload.
 */
const GenericToolBody = memo(function GenericToolBody({
  input,
  outputText,
}: {
  input: unknown;
  outputText: string;
}) {
  const theme = useThemeTokens();
  const pretty = useMemo(() => prettyJson(input), [input]);
  const hasInput = pretty.text && pretty.text !== 'undefined' && pretty.text !== '{}';
  return (
    <>
      {hasInput ? (
        <Text selectable style={[styles.mono, { color: theme.colors.textSubtle }]}>
          {pretty.text}
        </Text>
      ) : null}
      <OutputLines text={outputText} />
    </>
  );
});

const styles = StyleSheet.create({
  stretch: {
    alignSelf: 'stretch',
  },
  mono: {
    fontFamily: 'monospace',
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
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionText: {
    fontSize: AGENT_TYPE.micro.size,
    fontWeight: '600',
  },
  fileRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fileThumbWrap: {
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  fileThumb: {
    width: 140,
    height: 96,
    borderRadius: 12,
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
  grepNumber: {
    fontFamily: 'monospace',
    fontSize: AGENT_TYPE.micro.size,
    width: 34,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  grepMore: {
    fontSize: AGENT_TYPE.micro.size,
  },
  skillText: {
    fontSize: AGENT_TYPE.micro.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
});
