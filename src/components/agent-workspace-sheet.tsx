import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, Folder, FolderGit2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { KeyboardInset } from '@/components/keyboard-inset';
import { Input } from '@/components/themed-input';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { LADDER, SectionLabel, SettingsCard } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  buildAgentCacheKey,
  getAgentDirectories,
  getAgentProjects,
  getCachedAgentProjectsSync,
  type AgentProject,
  type DirectoryItem,
} from '@/lib/agent-session';

/**
 * The workspace switcher, as a native form sheet route. Presentational: the
 * route above it reads the projects and the handler out of the sheet bridge.
 */
export interface AgentWorkspaceSheetProps {
  activeDirectory?: string;
  sessionId?: string;
  initialProjects?: readonly AgentProject[];
  onSelectWorkspace: (directory: string, project?: AgentProject) => void;
  onClose: () => void;
}

export const AgentWorkspaceSheet = memo(function AgentWorkspaceSheet({
  activeDirectory,
  sessionId,
  initialProjects,
  onSelectWorkspace,
  onClose,
}: AgentWorkspaceSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();

  const [projects, setProjects] = useState<AgentProject[]>(() => {
    if (initialProjects && initialProjects.length > 0) {
      return initialProjects.filter((p) => p.id !== 'global' && p.canonical !== '/');
    }
    const cached = getCachedAgentProjectsSync(buildAgentCacheKey('projects', null, sessionId));
    if (cached && cached.length > 0) {
      return cached.filter((p) => p.id !== 'global' && p.canonical !== '/');
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DirectoryItem[]>([]);

  // A route mounts when it opens and unmounts when it is dismissed, so search
  // state starts clean and the project list is fetched once per opening --
  // which is what the host used to force with a changing `key`.
  const loadedOnceRef = useRef(false);
  const loadProjects = useCallback(async () => {
    if (!loadedOnceRef.current) setLoading(true);
    try {
      const list = await getAgentProjects(sessionId);
      const valid = (list || []).filter((p) => p.id !== 'global' && p.canonical !== '/');
      setProjects(valid);
      loadedOnceRef.current = true;
    } catch {
      // quiet fail
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadProjects().catch(() => {});
  }, [loadProjects]);

  // Autocomplete suggestions when typing custom path
  useEffect(() => {
    if (!searchQuery.trim().startsWith('/')) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const fetchDirs = async () => {
      try {
        const hits = await getAgentDirectories(searchQuery.trim(), undefined, sessionId);
        if (active) setSuggestions(hits);
      } catch {
        if (active) setSuggestions([]);
      }
    };
    const timer = setTimeout(fetchDirs, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, sessionId]);

  const filteredProjects = useMemo(() => {
    const valid = projects.filter((p) => p.id !== 'global' && p.canonical !== '/');
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.startsWith('/')) return valid;
    return valid.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.canonical.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  const handleSelect = (directory: string, project?: AgentProject) => {
    onSelectWorkspace(directory, project);
    onClose();
  };

  return (
    // One ground and one layout column: the two subviews a native form sheet
    // lays itself out around. See `sheet-ground.tsx`.
    <SheetFrame testID="agent-workspace-sheet" tint="background">
      <View collapsable={false} style={styles.sheetLayout}>
        {/* Pinned Top Navigation Bar */}
        <View style={styles.fixedTop}>
          <SheetHandle />

          <View style={styles.header}>
            <View style={[styles.headerCopy, plate]}>
              <Text variant="subheading" style={styles.headerTitle}>
                {t`Workspaces & Projects`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`Select or enter working repository`}
              </Text>
            </View>

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-workspace-close"
                accessibilityRole="button"
                accessibilityLabel={t`Close`}
                onPress={onClose}
                style={styles.headerButtonHit}>
                <X size={19} color={theme.colors.text} strokeWidth={2} />
              </PressableScale>
            </GlassChrome>
          </View>

          {/* Unified Search Input */}
          <Input
            testID="agent-workspace-search-input"
            accessibilityLabel={t`Filter projects or path`}
            placeholder={t`Filter projects or path`}
            value={searchQuery}
            onChangeText={setSearchQuery}
            variant="outline"
            autoCapitalize="none"
            autoCorrect={false}
            numberOfLines={1}
            multiline={false}
          />
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <Spinner size="lg" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.scrollViewport}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: LADDER.section + insets.bottom },
            ]}
            keyboardShouldPersistTaps="handled">
            {/* Custom Project Directory / Direct Path Input */}
            {searchQuery.trim().length > 0 &&
            (searchQuery.trim().startsWith('/') || searchQuery.trim().startsWith('~')) ? (
              <View style={styles.sectionBlock}>
                <SectionLabel title={t`CUSTOM PROJECT DIRECTORY`} color={theme.colors.textMuted} />
                <SettingsCard>
                  <PressableScale
                    testID="agent-workspace-custom-path-btn"
                    onPress={() => handleSelect(searchQuery.trim())}
                    style={styles.itemRow}>
                    <View style={styles.itemRowLeft}>
                      <FolderGit2 size={18} color={theme.colors.primary} />
                      <View style={styles.itemTextCol}>
                        <Text
                          variant="bodySmall"
                          weight="semibold"
                          color={theme.colors.primary}
                          numberOfLines={1}
                          style={styles.itemTitle}>
                          {t`Open as Project Workspace`}
                        </Text>
                        <Text
                          variant="caption"
                          color={theme.colors.textMuted}
                          numberOfLines={1}
                          style={styles.itemSub}>
                          {searchQuery.trim()}
                        </Text>
                      </View>
                    </View>
                  </PressableScale>
                </SettingsCard>
              </View>
            ) : null}

            {/* Suggestions for path */}
            {suggestions.length > 0 ? (
              <View style={styles.sectionBlock}>
                <SectionLabel title={t`DIRECTORY AUTOCOMPLETE`} color={theme.colors.textMuted} />
                <SettingsCard>
                  {suggestions.map((item) => (
                    <PressableScale
                      key={item.path}
                      onPress={() => handleSelect(item.path)}
                      style={styles.itemRow}>
                      <View style={styles.itemRowLeft}>
                        <Folder size={16} color={theme.colors.primary} />
                        <Text
                          variant="bodySmall"
                          color={theme.colors.text}
                          numberOfLines={1}
                          style={styles.itemTitle}>
                          {item.name || item.path}
                        </Text>
                      </View>
                      <Text
                        variant="caption"
                        color={theme.colors.textMuted}
                        numberOfLines={1}
                        style={styles.pathSubtext}>
                        {item.path}
                      </Text>
                    </PressableScale>
                  ))}
                </SettingsCard>
              </View>
            ) : null}

            {/* Known Projects */}
            <View style={styles.sectionBlock}>
              <SectionLabel title={t`KNOWN REPOSITORIES`} color={theme.colors.textMuted} />
              {filteredProjects.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    <Trans>No projects found. Enter a custom path above.</Trans>
                  </Text>
                </View>
              ) : (
                <SettingsCard>
                  {filteredProjects.map((p) => {
                    const isSelected = activeDirectory === p.canonical;

                    return (
                      <PressableScale
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: Boolean(isSelected) }}
                        onPress={() => handleSelect(p.canonical, p)}
                        style={[
                          styles.itemRow,
                          isSelected && {
                            backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                          },
                        ]}>
                        <View style={styles.itemRowLeft}>
                          <FolderGit2
                            size={18}
                            color={isSelected ? theme.colors.primary : theme.colors.text}
                          />
                          <View style={styles.itemTextCol}>
                            <Text
                              variant="bodySmall"
                              weight={isSelected ? 'semibold' : 'regular'}
                              color={isSelected ? theme.colors.primary : theme.colors.text}
                              numberOfLines={1}
                              style={styles.itemTitle}>
                              {p.name || p.id}
                            </Text>
                            <Text
                              variant="caption"
                              color={theme.colors.textMuted}
                              numberOfLines={1}
                              style={styles.itemSub}>
                              {p.canonical}
                            </Text>
                          </View>
                        </View>

                        {isSelected ? <Check size={18} color={theme.colors.primary} /> : null}
                      </PressableScale>
                    );
                  })}
                </SettingsCard>
              )}
            </View>
            {/* The filter field is pinned above this scroller, so nothing
                scrolls the last repository clear of the keys by itself. */}
            <KeyboardInset />
          </ScrollView>
        )}
      </View>
    </SheetFrame>
  );
});

const styles = StyleSheet.create({
  // The stack renders form sheets over a transparent background so the native
  // sheet keeps its own corners; without filling the height, that transparency
  // shows as a strip under the content.
  sheetLayout: {
    flex: 1,
  },
  fixedTop: {
    flexShrink: 0,
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap * 1.5,
    paddingBottom: LADDER.gap,
    gap: LADDER.snug,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerTitle: {
    includeFontPadding: false,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  headerButtonHit: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
    gap: LADDER.section,
  },
  sectionBlock: {
    gap: LADDER.snug,
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
  },
  itemRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  itemTextCol: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    includeFontPadding: false,
  },
  itemSub: {
    fontSize: 11,
  },
  pathSubtext: {
    fontSize: 11,
    maxWidth: 150,
  },
});
