import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// No native renderer in this repository: keep the geometry wiring and the
// intentional content shapes under a focused source contract.
const read = (name: string) => readFileSync(`src/components/${name}.tsx`, 'utf8');
const styleBlock = (source: string, name: string) => {
  const match = source.match(new RegExp(`  ${name}: \\{([\\s\\S]*?)\\n  \\},`));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
};

describe('workspace chrome follows the appearance profile', () => {
  test('surfaces and generic controls consume tokens without profile-ID branches or remounts', () => {
    const seams = {
      'agent-composer': ['profile.chrome.control', 'shape="sheet"', 'shape="popover"'],
      'ssh-terminal-workspace': ['profile.radius.pill', 'shape="composerDock"'],
      'ssh-host-list': ['profile.radius.pill'],
      'ssh-host-row': ['profile.chrome.noticeCard'],
      'terminal-boundary': ['profile.radius.pill'],
      'terminal-notice': ['profile.chrome.transcriptPlate'],
      'themed-segmented-control': [
        'profile.chrome.segmentedTrack',
        'profile.chrome.segmentedOption',
        'profile.radius.pill',
      ],
    };
    for (const [file, tokens] of Object.entries(seams)) {
      const source = read(file);
      expect(source).toContain('useAppearanceProfile()');
      expect(source).not.toContain('profile.id');
      expect(source).not.toContain('key={profile');
      for (const token of tokens) expect(source).toContain(token);
    }
  });

  test('segmented controls keep pill opt-in, disabled semantics and stable option identity', () => {
    const source = read('themed-segmented-control');
    expect(source).not.toContain('BaseSegmentedControl');
    expect(source).not.toContain('opacity === 1');
    expect(source).toContain(
      "variant === 'pill' ? profile.radius.pill : profile.chrome.segmentedTrack"
    );
    expect(source).toContain(
      "variant === 'pill' ? profile.radius.pill : profile.chrome.segmentedOption"
    );
    expect(source).toContain('key={option.value}');
    expect(source).toContain('disabled={disabled}');
    expect(source).toContain('accessibilityState={{ selected, disabled }}');
    expect(source).toContain('onPress={() => onChange(option.value)}');
    expect(source).toContain('feedback="selection"');
  });

  test('docks and inbox plates have no fixed local radius', () => {
    const composer = read('agent-composer');
    const ssh = read('ssh-terminal-workspace');
    expect(composer).toContain('shape="sheet"');
    expect(ssh).toContain('shape="composerDock"');
    for (const name of ['composerDock', 'inboxCard', 'inboxRow']) {
      expect(styleBlock(composer, name)).not.toContain('Radius:');
    }
    expect(styleBlock(ssh, 'dock')).not.toContain('Radius:');
  });

  test('the error boundary still resets on a pane change and retries only when asked', () => {
    const source = read('terminal-boundary');
    expect(source).toContain('previous.resetKey !== this.props.resetKey && this.state.failed');
    expect(source).toContain('if (!this.state.failed) return this.props.children;');
    expect(source).toContain('onPress={() => this.setState({ failed: false })}');
    expect(source).toContain('onPress={onPress}');
  });

  test('existing transcript and update surfaces retain their shared geometry owners', () => {
    const message = read('agent-message-block');
    expect(message).toContain('style={[styles.toolGroupHeader, plate]}');
    expect(message).toContain('style={[styles.messageBlock, plate]}');
    expect(message).toContain('styles.noticeBlock, plate');
    expect(read('update-status-banner')).toContain('useNotificationSurfaceStyle()');
  });

  test('semantic pills, circles and keycaps keep their intentional shapes', () => {
    const composer = read('agent-composer');
    for (const name of ['sessionChip', 'backChip', 'queuedChip', 'compactionPill']) {
      expect(styleBlock(composer, name)).toContain('borderRadius: 999');
    }
    const ssh = read('ssh-terminal-workspace');
    expect(styleBlock(ssh, 'terminalKey')).toContain('borderRadius: 12');
    expect(styleBlock(ssh, 'keyRowToggle')).toContain('borderRadius: 12');
    expect(styleBlock(ssh, 'statusDot')).toContain('borderRadius: 3.5');
    for (const name of ['rowIcon', 'rowAction']) {
      expect(styleBlock(read('ssh-host-row'), name)).toContain('borderRadius: 20');
    }
    expect(styleBlock(read('update-status-banner'), 'icon')).toContain('borderRadius: 18');
  });
});

describe('shared primitives use quiet borders without changing emphasis', () => {
  test('local surface outlines and input underlines use the shared hairline', () => {
    for (const name of [
      'themed-input',
      'themed-search-input',
      'themed-button',
      'themed-card',
      'notice-deck',
      'agent-mode-menu',
      'app-error-boundary',
      'settings-home-layout-sheet',
    ]) {
      const source = read(name);
      expect(source).toContain('StyleSheet.hairlineWidth');
      expect(source.match(/border(?:Top|Bottom|Left|Right)?Width:\s*1\b/)).toBeNull();
      expect(source).not.toContain('profile.id');
    }
    // Outline inputs are fill-only today; do not introduce an outline while
    // thinning their underline sibling.
    expect(read('themed-input').match(/\bborderWidth:/)).toBeNull();
    expect(read('themed-input')).toContain('borderBottomWidth: StyleSheet.hairlineWidth');
  });

  test('delegated cards and both button paths preserve borderless variants and caller emphasis', () => {
    const card = read('themed-card');
    expect(card).toContain("border = 'none'");
    expect(card).toContain('border={border}');
    expect(
      card.match(
        /\(border === 'subtle' \|\| Boolean\(theme.components.Card\[variant\].border\)\) && \{\s*borderWidth: StyleSheet.hairlineWidth,\s*\},\s*style,/
      )
    ).not.toBeNull();
    const button = read('themed-button');
    expect(button).toContain('variantTokens.border &&');
    expect(button.match(/borderWidth: StyleSheet.hairlineWidth/g)?.length).toBe(2);
    expect(
      button.match(
        /<BaseButton[\s\S]*?variantTokens.border && \{ borderWidth: StyleSheet.hairlineWidth \}\),\s*\.\.\.style,/
      )
    ).not.toBeNull();
    expect(button.match(/style=\{\[\s*buttonStyle,\s*animatedStyle,\s*style,/)).not.toBeNull();
  });

  test('kit alerts, toast cards and ordinary option cards receive supported style overrides', () => {
    const approval = read('approval-banner');
    expect(approval).toContain("import { Card } from '@/components/themed-card'");
    expect(approval.match(/<Alert[^>]*style=\{styles.alert\}/g)?.length).toBe(2);
    expect(approval).toContain('alert: { borderWidth: StyleSheet.hairlineWidth }');
    for (const name of ['approval-banner', 'composer-popup']) {
      const source = read(name);
      expect(source).toContain(
        'borderWidth: theme.components.Card.flat.border ? StyleSheet.hairlineWidth : 0'
      );
      // These lists have card perimeters, not bottom separators on every row.
      expect(source).not.toContain('borderBottomWidth');
    }
    const root = readFileSync('src/app/_layout.tsx', 'utf8');
    expect(
      root.match(/toastStyle=\{\[[\s\S]*?borderWidth: StyleSheet.hairlineWidth/)
    ).not.toBeNull();
  });

  test('selection rings and the Escape keycap retain their emphasis', () => {
    expect(styleBlock(read('settings-home-layout-sheet'), 'radio')).toContain('borderWidth: 2');
    expect(styleBlock(read('approval-banner'), 'escape')).not.toContain('borderWidth');
    // Layout choices and mode options have no trailing row divider to thin.
    expect(styleBlock(read('settings-home-layout-sheet'), 'option')).not.toContain('border');
    expect(styleBlock(read('agent-mode-menu'), 'option')).not.toContain('borderBottomWidth');
  });
});

describe('route-owned chrome follows the appearance profile', () => {
  const commands = readFileSync('src/app/commands.tsx', 'utf8');
  const pairing = readFileSync('src/app/explore.tsx', 'utf8');

  test('quick actions, Home panels, task rows and pairing notices consume semantic roles', () => {
    const seams = [
      [commands, ['profile.chrome.control', 'profile.chrome.popover']],
      [read('home-connections'), ['profile.chrome.surface']],
      [read('home-attention'), ['profile.chrome.noticeCard']],
      [read('new-task-sheet'), ['profile.chrome.control']],
      [pairing, ['profile.chrome.control', 'profile.chrome.noticeBanner']],
    ] as const;
    for (const [source, tokens] of seams) {
      expect(source).toContain('useAppearanceProfile()');
      expect(source).not.toContain('profile.id');
      // AgentProfile.kind is the existing agent identity, not an appearance key.
      expect(source).not.toContain('key={profile}');
      for (const token of tokens) expect(source).toContain(`borderRadius: ${token}`);
    }
    for (const name of ['tile', 'group', 'deleteButton']) {
      expect(styleBlock(commands, name)).not.toContain('Radius:');
    }
    for (const name of ['manualToggle', 'installRow', 'successCard', 'message']) {
      expect(styleBlock(pairing, name)).not.toContain('Radius:');
    }
    expect(styleBlock(read('home-attention'), 'row')).not.toContain('Radius:');
    expect(styleBlock(read('new-task-sheet'), 'recentRow')).not.toContain('Radius:');
    expect(read('home-connections')).toContain(
      'styles.connectionGroup, { borderRadius: profile.chrome.surface }'
    );
  });

  test('Home separators are hairlines between items, including mixed Gateway and SSH lists', () => {
    const connections = read('home-connections');
    expect(connections).toContain('hasSeparator={index < servers.length + hosts.length - 1}');
    expect(
      /index < hosts.length - 1 && \{\s*borderBottomColor: theme.colors.border,\s*borderBottomWidth: StyleSheet.hairlineWidth/.test(
        connections
      )
    ).toBe(true);
    expect(
      /hasSeparator && \{\s*borderBottomColor: theme.colors.border,\s*borderBottomWidth: StyleSheet.hairlineWidth/.test(
        connections
      )
    ).toBe(true);
    expect(styleBlock(connections, 'row')).not.toContain('border');
    const attention = read('home-attention');
    expect(styleBlock(attention, 'row')).toContain('borderWidth: StyleSheet.hairlineWidth');
    expect(styleBlock(attention, 'row')).toContain('borderLeftWidth: 4');
    // These lists use spacing rather than bottom borders. Attention cards retain
    // their perimeter, and the scanner's bottom strokes are not list dividers.
    for (const name of ['row', 'group']) {
      expect(styleBlock(commands, name)).not.toContain('borderBottom');
    }
    expect(styleBlock(read('new-task-sheet'), 'recentRow')).not.toContain('borderBottom');
    expect(styleBlock(pairing, 'manualToggle')).not.toContain('borderBottom');
    expect(styleBlock(pairing, 'installRow')).not.toContain('borderBottom');

    const diffRows = read('diff-rows');
    expect(diffRows).toContain('hasSeparator={index < rows.length - 1}');
    expect(diffRows).toContain('hasSeparator={index < capped.rows.length - 1}');
    expect(diffRows).toContain('borderBottomWidth: hasSeparator ? StyleSheet.hairlineWidth : 0');
    expect(styleBlock(diffRows, 'fileRow')).not.toContain('borderBottomWidth');
  });

  test('scanner geometry, keycaps, pills and selection emphasis remain content-owned', () => {
    expect(styleBlock(pairing, 'aperture')).toContain('borderRadius: 24');
    expect(styleBlock(pairing, 'aperture')).toContain('borderWidth: StyleSheet.hairlineWidth');
    expect(styleBlock(pairing, 'scanFrame')).toContain('width: 214');
    expect(styleBlock(pairing, 'scanFrame')).toContain('height: 214');
    for (const [corner, radius] of [
      ['cornerTopLeft', 'borderTopLeftRadius'],
      ['cornerTopRight', 'borderTopRightRadius'],
      ['cornerBottomLeft', 'borderBottomLeftRadius'],
      ['cornerBottomRight', 'borderBottomRightRadius'],
    ]) {
      expect(styleBlock(pairing, corner)).toContain(`${radius}: 14`);
    }
    expect(styleBlock(pairing, 'successIcon')).toContain('borderRadius: 32');
    expect(styleBlock(commands, 'keyCap')).toContain('borderRadius: 8');
    const task = read('new-task-sheet');
    expect(styleBlock(task, 'pill')).toContain('borderRadius: 12');
    expect(styleBlock(task, 'pill')).toContain('borderWidth: 1');
    expect(task).toContain("borderColor: selected ? theme.colors.primary : 'transparent'");
    expect(task).toContain('agentSpawnRequest({ agent, cwd, tabId, prompt: firstPrompt })');
    expect(task).toContain(
      'if (!mounted.current || useGatewayConnectionStore.getState().record !== owner) return;'
    );
    expect(commands).toContain(
      'await sendPaneText(params.sessionId, params.paneId, command.value)'
    );
    expect(commands).toContain('await agentDelivery.send(command.value)');
  });
});
