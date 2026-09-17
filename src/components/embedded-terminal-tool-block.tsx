import { createElement, useEffect, memo, useMemo, useState, type ComponentType } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  AlertCircle,
  Braces,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FilePen,
  FilePlus,
  FileText,
  GitFork,
  Globe,
  Loader2,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { PressableScale } from '@/components/pressable-scale';
import { usePaneChatColors, usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { fadeIn, fadeOut, timing } from '@/lib/motion';
import { keyedLines } from '@/lib/line-keys';
import type { ToolCallState } from '@/lib/agent-protocol';

export interface EmbeddedTerminalProps {
  toolId: string;
  toolName: string;
  command?: string;
  input?: unknown;
  output?: unknown;
  status: ToolCallState;
  defaultExpanded?: boolean;
}

interface ParsedToolOutput {
  stdout: string;
  exitCode?: number;
}

function parseToolOutput(raw: unknown): ParsedToolOutput {
  if (!raw) return { stdout: '' };

  let data: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        // Keep as raw string
      }
    }
  }

  // If data is array (OpenCode's standard tool output: [{"text": "...", "type": "text"}, {"text": "Command exited with code 0.", "type": "text"}])
  if (Array.isArray(data)) {
    let stdout = '';
    let exitCode: number | undefined;

    for (const item of data) {
      const text =
        typeof item === 'object' && item && 'text' in item
          ? String((item as { text: unknown }).text)
          : typeof item === 'string'
            ? item
            : '';

      const exitMatch = text.match(/Command exited with code (\d+)/i);
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10);
      } else if (!stdout) {
        // First text content is command stdout!
        stdout = text;
      } else {
        stdout += `\n${text}`;
      }
    }

    return {
      stdout: stdout || (data.length > 0 ? JSON.stringify(data, null, 2) : ''),
      exitCode,
    };
  }

  if (typeof data === 'object' && data !== null) {
    const rec = data as Record<string, unknown>;
    if (typeof rec.stdout === 'string') {
      return {
        stdout: rec.stdout,
        exitCode: typeof rec.exitCode === 'number' ? rec.exitCode : undefined,
      };
    }
    if (typeof rec.output === 'string') return parseToolOutput(rec.output);
    if (Array.isArray(rec.content)) return parseToolOutput(rec.content);
    if (typeof rec.text === 'string') return { stdout: rec.text };
    return { stdout: JSON.stringify(data, null, 2) };
  }

  return { stdout: String(data) };
}

/** The tool families OpenCode ships, plus a bucket for MCP additions. */
type ToolKind =
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'patch'
  | 'search'
  | 'web'
  | 'subagent'
  | 'skill'
  | 'code'
  | 'mcp';

function classifyTool(name: string): ToolKind {
  const n = name.toLowerCase();
  if (n === 'shell' || n === 'bash' || n === 'terminal' || n === 'run') return 'shell';
  if (n === 'read' || n === 'list') return 'read';
  if (n === 'edit' || n === 'multiedit' || n === 'str_replace' || n === 'str_replace_editor') {
    return 'edit';
  }
  if (n === 'write' || n === 'create' || n === 'new_file') return 'write';
  if (n === 'patch' || n === 'apply_patch') return 'patch';
  if (n === 'grep' || n === 'glob' || n === 'search' || n === 'find') return 'search';
  if (n === 'webfetch' || n === 'fetch' || n === 'websearch' || n === 'web_search') return 'web';
  if (n === 'subagent' || n === 'task' || n === 'spawn' || n === 'agent') return 'subagent';
  if (n === 'skill' || n === 'load_skill') return 'skill';
  if (n === 'execute' || n === 'code') return 'code';
  return 'mcp';
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

/** Fence language for a file path, when the markdown renderer has a grammar. */
const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  go: 'go',
  java: 'java',
  py: 'python',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  swift: 'swift',
  php: 'php',
  rb: 'ruby',
  cs: 'c-sharp',
};

function fenceLanguageForPath(path?: string): string | undefined {
  if (!path) return undefined;
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? LANG_BY_EXT[ext] : undefined;
}

function pickString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** The one-line target a tool is pointed at: the path, the pattern, the URL… */
function extractTarget(kind: ToolKind, input: unknown): string {
  const rec = asRecord(input);
  if (!rec) return typeof input === 'string' ? input : '';
  switch (kind) {
    case 'shell':
      return pickString(rec, ['command', 'cmd']) ?? '';
    case 'read':
      return pickString(rec, ['path', 'filePath', 'file_path', 'file']) ?? '';
    case 'edit':
    case 'write':
      return pickString(rec, ['path', 'filePath', 'file_path', 'file']) ?? '';
    case 'patch':
      // `*** Add File: path` / `*** Update File: path` / `*** Delete File: path`
      return (
        pickString(rec, ['patchText', 'patch_text', 'patch'])?.match(
          /\*\*\* [A-Za-z]+ File: (.+)/
        )?.[1] ??
        pickString(rec, ['patchText', 'patch_text', 'patch'])
          ?.split('\n')
          .find((line) => line.startsWith('*** '))
          ?.replace(/^\*\*\* [A-Za-z]+ File: /, '') ??
        ''
      );
    case 'search':
      return pickString(rec, ['pattern', 'query', 'literal']) ?? '';
    case 'web':
      return pickString(rec, ['url', 'query']) ?? '';
    case 'subagent':
      return (
        pickString(rec, ['description', 'agentID', 'agent_id', 'subagent', 'agent']) ??
        pickString(rec, ['prompt'])?.split('\n')[0] ??
        ''
      );
    case 'skill':
      return pickString(rec, ['skillID', 'skill_id', 'skillId', 'skill', 'id']) ?? '';
    default:
      return (
        pickString(rec, ['command', 'cmd', 'path', 'filePath', 'query', 'url', 'pattern']) ??
        (typeof input === 'string' ? input : '')
      );
  }
}

/** Static icon per tool family — component references resolve to fixed imports. */
const TOOL_ICONS: Record<ToolKind, ComponentType<{ size?: number; color?: string }>> = {
  shell: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePlus,
  patch: FileDiff,
  search: Search,
  web: Globe,
  subagent: GitFork,
  skill: Sparkles,
  code: Braces,
  mcp: Wrench,
};

const MINI_DIFF_MAX_LINES = 6;

/**
 * One tool call, as OpenCode's own output shows it: a single quiet line naming
 * the tool and its target, with the part that matters for that tool — an edit
 * shows its before/after, a write its content, a patch its text — and the bare
 * command/output behind an animated expand. No card, no background, no chrome.
 */
export const EmbeddedTerminalToolBlock = memo(function EmbeddedTerminalToolBlock({
  toolName,
  command,
  input,
  output,
  status,
  defaultExpanded = false,
}: EmbeddedTerminalProps) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const kind = useMemo(() => classifyTool(toolName), [toolName]);

  const rec = asRecord(input);
  const displayCommand = useMemo(() => {
    if (command) return command;
    return extractTarget(kind, input);
  }, [command, kind, input]);

  const oldString = rec ? pickString(rec, ['oldString', 'old_string']) : undefined;
  const newString = rec ? pickString(rec, ['newString', 'new_string']) : undefined;
  const content = rec ? pickString(rec, ['content']) : undefined;
  const patchText = rec ? pickString(rec, ['patchText', 'patch_text', 'patch']) : undefined;

  const oldKeyed = useMemo(() => (oldString ? keyedLines(oldString) : []), [oldString]);
  const newKeyed = useMemo(() => (newString ? keyedLines(newString) : []), [newString]);
  const contentKeyed = useMemo(() => (content ? keyedLines(content) : []), [content]);
  const patchKeyed = useMemo(() => (patchText ? keyedLines(patchText) : []), [patchText]);

  // The markdown renderer's tree-sitter grammars highlight file bodies; only
  // when the tool target reveals a known language.
  const markdownStyle = usePaneChatMarkdownStyle();
  const paneColors = usePaneChatColors();
  const highlightLang = useMemo(
    () => (kind === 'write' || kind === 'edit' ? fenceLanguageForPath(displayCommand) : undefined),
    [kind, displayCommand]
  );
  const fencedHighlight = useMemo(() => {
    if (!highlightLang) return null;
    const body = kind === 'write' ? content : newString;
    if (!body) return null;
    return `\`\`\`${highlightLang}\n${body}\n\`\`\``;
  }, [highlightLang, kind, content, newString]);

  const renderHighlighted = (key: string, fenced: string) => (
    <EnrichedMarkdownText
      key={key}
      flavor="commonmark"
      markdown={fenced}
      markdownStyle={markdownStyle}
      containerStyle={styles.highlightedCode}
      selectable
      streamingAnimation={false}
      textBreakStrategy="simple"
    />
  );

  // Extract output text and unwrap structured JSON wrappers
  const parsedOutput = useMemo(() => parseToolOutput(output), [output]);
  const outputText = parsedOutput.stdout;
  const exitCode = parsedOutput.exitCode;

  const statusColor =
    status === 'completed'
      ? theme.colors.success
      : status === 'failed'
        ? theme.colors.danger
        : theme.colors.warning;
  // The transcript and the diff sheet paint an added line the same way,
  // because `usePaneChatColors` prefers the terminal palette's own green and
  // red -- so one change reads identically in the terminal and here.
  const addedColor = paneColors.added;
  const removedColor = paneColors.removed;

  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing());
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 90}deg` }],
    opacity: 1,
  }));

  const hasBody =
    Boolean(outputText) ||
    oldKeyed.length > 0 ||
    Boolean(content) ||
    Boolean(patchText) ||
    status === 'running' ||
    status === 'pending' ||
    status === 'streaming';

  return (
    <Animated.View style={styles.container}>
      {/* Header: one quiet line — tool, target, outcome */}
      <PressableScale
        testID="agent-tool-toggle"
        accessibilityRole="button"
        accessibilityLabel={expanded ? t`Collapse tool call` : t`Expand tool call`}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.header}>
        <View style={styles.headerLeft}>
          {createElement(TOOL_ICONS[kind], { size: 12, color: theme.colors.textMuted })}
          <Text
            variant="caption"
            weight="medium"
            color={theme.colors.textMuted}
            style={styles.toolBadge}>
            {toolName}
          </Text>
          {displayCommand ? (
            <Text
              variant="caption"
              numberOfLines={1}
              color={theme.colors.textSubtle}
              style={styles.commandPreview}>
              {displayCommand}
            </Text>
          ) : null}
          {content ? (
            <Text variant="caption" color={theme.colors.textSubtle} style={styles.exitCodeText}>
              {`+${content.split('\n').length} lines`}
            </Text>
          ) : null}
          {status === 'running' || status === 'pending' || status === 'streaming' ? (
            <Loader2 size={11} color={statusColor} />
          ) : status === 'failed' ? (
            <AlertCircle size={11} color={statusColor} />
          ) : null}
          {exitCode !== undefined ? (
            <Text
              variant="caption"
              weight="semibold"
              color={exitCode === 0 ? addedColor : removedColor}
              style={styles.exitCodeText}>
              {`exit ${exitCode}`}
            </Text>
          ) : null}
        </View>
        {hasBody ? (
          <Animated.View entering={fadeIn('micro')} style={chevronStyle}>
            {expanded ? (
              <ChevronDown size={12} color={theme.colors.textMuted} />
            ) : (
              <ChevronRight size={12} color={theme.colors.textMuted} />
            )}
          </Animated.View>
        ) : null}
      </PressableScale>

      {/* An edit's before/after is the content — short enough to show in place */}
      {kind === 'edit' && (oldKeyed.length > 0 || newKeyed.length > 0) ? (
        <View style={styles.miniDiff}>
          {oldKeyed.slice(0, MINI_DIFF_MAX_LINES).map(({ line, key }) => (
            <View key={key} style={styles.diffLineRow}>
              <Text selectable style={[styles.codeText, { color: removedColor }]}>
                - {line || ' '}
              </Text>
            </View>
          ))}
          {newKeyed.slice(0, MINI_DIFF_MAX_LINES).map(({ line, key }) => (
            <View key={key} style={styles.diffLineRow}>
              <Text selectable style={[styles.codeText, { color: theme.colors.text }]}>
                <Text style={{ color: addedColor }}>+ </Text>
                {line || ' '}
              </Text>
            </View>
          ))}
          {oldKeyed.length > MINI_DIFF_MAX_LINES || newKeyed.length > MINI_DIFF_MAX_LINES ? (
            <Text variant="caption" color={theme.colors.textSubtle} style={styles.runningText}>
              <Trans>… open for the full change</Trans>
            </Text>
          ) : null}
        </View>
      ) : null}

      {expanded ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={[styles.terminalWindow, { borderLeftColor: theme.colors.border }]}>
          {/* The rest of the edit, beyond the in-place preview */}
          {kind === 'edit' && oldKeyed.length > MINI_DIFF_MAX_LINES
            ? oldKeyed.slice(MINI_DIFF_MAX_LINES).map(({ line, key }) => (
                <View key={key} style={styles.diffLineRow}>
                  <Text selectable style={[styles.codeText, { color: removedColor }]}>
                    - {line || ' '}
                  </Text>
                </View>
              ))
            : null}
          {kind === 'edit' && newKeyed.length > MINI_DIFF_MAX_LINES && !highlightLang
            ? newKeyed.slice(MINI_DIFF_MAX_LINES).map(({ line, key }) => (
                <View key={key} style={styles.diffLineRow}>
                  <Text selectable style={[styles.codeText, { color: theme.colors.text }]}>
                    <Text style={{ color: addedColor }}>+ </Text>
                    {line || ' '}
                  </Text>
                </View>
              ))
            : null}
          {kind === 'edit' && fencedHighlight ? (
            <View style={styles.outputContent}>
              {renderHighlighted('edit-new', fencedHighlight)}
            </View>
          ) : null}

          {/* A write's content is the change itself */}
          {kind === 'write' && contentKeyed.length > 0 ? (
            fencedHighlight ? (
              <View style={styles.outputContent}>
                {renderHighlighted('write-content', fencedHighlight)}
              </View>
            ) : (
              <View style={styles.outputContent}>
                {contentKeyed.map(({ line, key }) => {
                  const added = line.startsWith('+');
                  const removed = line.startsWith('-');
                  return (
                    <Text
                      key={key}
                      selectable
                      style={[
                        styles.codeText,
                        {
                          color: added ? addedColor : removed ? removedColor : theme.colors.text,
                        },
                      ]}>
                      {line || ' '}
                    </Text>
                  );
                })}
              </View>
            )
          ) : null}

          {/* A patch's text, marker-coloured */}
          {kind === 'patch' && patchKeyed.length > 0 ? (
            <View style={styles.outputContent}>
              {patchKeyed.map(({ line, key }) => {
                const added = line.startsWith('+');
                const removed = line.startsWith('-');
                const section = line.startsWith('***');
                return (
                  <Text
                    key={key}
                    selectable
                    style={[
                      styles.codeText,
                      {
                        color: added
                          ? addedColor
                          : removed
                            ? removedColor
                            : section
                              ? theme.colors.primary
                              : theme.colors.textMuted,
                      },
                    ]}>
                    {line || ' '}
                  </Text>
                );
              })}
            </View>
          ) : null}

          {outputText ? (
            <Text
              selectable
              style={[styles.codeText, styles.outputWrap, { color: theme.colors.textMuted }]}>
              {outputText}
            </Text>
          ) : status === 'running' ? (
            <Text variant="caption" color={theme.colors.textMuted} style={styles.runningText}>
              <Trans>Running command in background…</Trans>
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginVertical: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  toolBadge: {
    fontSize: 11.5,
  },
  commandPreview: {
    fontFamily: 'monospace',
    fontSize: 11,
    flexShrink: 1,
  },
  exitCodeText: {
    fontSize: 10.5,
  },
  miniDiff: {
    marginLeft: 12,
    marginTop: 1,
    paddingLeft: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  diffLineRow: {
    flexDirection: 'row',
  },
  terminalWindow: {
    marginLeft: 12,
    marginTop: 2,
    marginBottom: 2,
    paddingLeft: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  outputScroll: {
    maxWidth: '100%',
  },
  outputContent: {
    paddingVertical: 2,
  },
  highlightedCode: {
    alignSelf: 'stretch',
  },
  outputWrap: {
    lineHeight: 17,
    maxWidth: '100%',
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 11.5,
    lineHeight: 16,
  },
  runningText: {
    fontStyle: 'italic',
    fontSize: 11,
  },
});
