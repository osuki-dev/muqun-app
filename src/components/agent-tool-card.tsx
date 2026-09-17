import { memo, useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { FileText, GitFork, Play } from 'lucide-react-native';
import { Image } from 'expo-image';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { AgentTodoBlock } from '@/components/agent-todo-block';
import {
  EmbeddedTerminalToolBlock,
  isToolPending,
} from '@/components/embedded-terminal-tool-block';
import { InlineDiffRows } from '@/components/diff-rows';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { isSafeExternalLink } from '@/lib/safe-link';
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

/** Monospace body, syntax-highlighted when the renderer has a grammar for it. */
const CodeBody = memo(function CodeBody({
  body,
  language,
  markdownStyle,
}: {
  body: string;
  language?: string;
  markdownStyle: MarkdownStyle;
}) {
  const fenced = useMemo(() => fencedCode(body, language), [body, language]);
  return (
    <EnrichedMarkdownText
      flavor="commonmark"
      markdown={fenced.text}
      markdownStyle={markdownStyle}
      containerStyle={styles.stretch}
      selectable
      streamingAnimation={false}
      textBreakStrategy="simple"
    />
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
  const [showAll, setShowAll] = useState(false);
  const capped = useMemo(() => (showAll ? { text, hidden: 0 } : capLines(text)), [text, showAll]);

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
          onPress={() => setShowAll(true)}
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
const PatchBody = memo(function PatchBody({ patch }: { patch: string }) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const rows = useMemo(() => diffRowsForFence(patch), [patch]);
  if (rows.length === 0) return null;
  return (
    <InlineDiffRows
      rows={rows}
      colors={colors}
      gutterFill={theme.colors.surface}
      headerFill={theme.colors.surfaceRaised}
    />
  );
});

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export const AgentToolCard = memo(function AgentToolCard({
  part,
  markdownStyle,
  childStatus,
  onOpenChildSession,
  onRunInBackground,
  onOpenBackgroundTray,
  onPreviewImage,
  onOpenFile,
}: AgentToolCardProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
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
      const body = stripReadLineNumbers(outputText);
      if (!body) return null;
      return <CodeBody body={body} language={language} markdownStyle={markdownStyle} />;
    }

    case 'edit': {
      if (args.editFiles.length > 0) return <EditDiffs files={args.editFiles} />;
      // No `metadata.files`: an older engine, or a tool that answered without
      // one. The before and after are still a diff, just one we assemble.
      if (args.oldString || args.newString) {
        return <PatchBody patch={syntheticPatch(target, args.oldString, args.newString)} />;
      }
      return <OutputLines text={outputText} />;
    }

    case 'write':
      return args.writeContent ? (
        <CodeBody
          body={args.writeContent}
          language={fenceLanguageForPath(target)}
          markdownStyle={markdownStyle}
        />
      ) : (
        <OutputLines text={outputText} />
      );

    case 'patch':
      return args.patchSections.length > 0 ? (
        <>
          {args.patchSections.map((section) => (
            <View key={`${section.action}:${section.path}`} style={styles.stretch}>
              <PatchBody patch={section.patch} />
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
        <EnrichedMarkdownText
          flavor="commonmark"
          markdown={args.subagentText}
          markdownStyle={markdownStyle}
          containerStyle={styles.stretch}
          selectable
          streamingAnimation={false}
          textBreakStrategy="simple"
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

/** A `+`/`-` patch made from a before and an after, when no real one came. */
function syntheticPatch(path: string, oldString?: string, newString?: string): string {
  const removed = (oldString ?? '')
    .split('\n')
    .filter((_, index, all) => index < all.length || true);
  const added = (newString ?? '').split('\n');
  const lines: string[] = [`@@ ${path} @@`];
  if (oldString) for (const line of removed) lines.push(`-${line}`);
  if (newString) for (const line of added) lines.push(`+${line}`);
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
}: {
  files: ReturnType<typeof editFilesFromMetadata>;
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
      headerFill={theme.colors.surfaceRaised}
      onToggleFile={toggle}
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
  const theme = useThemeTokens();
  return (
    <EnrichedMarkdownText
      flavor="github"
      markdown={markdown}
      markdownStyle={markdownStyle}
      containerStyle={styles.stretch}
      selectable
      selectionColor={theme.colors.primary}
      streamingAnimation={false}
      textBreakStrategy="simple"
      onLinkPress={({ url }) => {
        if (isSafeExternalLink(url)) void Linking.openURL(url);
      }}
    />
  );
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
    fontSize: 11.5,
    lineHeight: 16,
  },
  command: {
    fontWeight: '600',
  },
  chipText: {
    fontSize: 10.5,
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
    fontSize: 11,
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
    fontSize: 12,
    flexShrink: 1,
  },
  grepGroup: {
    gap: 1,
    marginBottom: 4,
  },
  grepFile: {
    fontSize: 11,
  },
  grepLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  grepNumber: {
    fontFamily: 'monospace',
    fontSize: 10,
    width: 34,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  grepMore: {
    fontSize: 10.5,
  },
  skillText: {
    fontSize: 11,
    lineHeight: 16,
  },
});
