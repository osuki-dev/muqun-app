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

  test('semantic pills, circles, keycaps and content thumbnails keep their intentional shapes', () => {
    const composer = read('agent-composer');
    for (const name of [
      'sessionChip',
      'backChip',
      'actionBtn',
      'actionBtnWithLabel',
      'queuedChip',
      'compactionPill',
    ]) {
      expect(styleBlock(composer, name)).toContain('borderRadius: 999');
    }
    const ssh = read('ssh-terminal-workspace');
    expect(styleBlock(ssh, 'terminalKey')).toContain('borderRadius: 12');
    expect(styleBlock(ssh, 'keyRowToggle')).toContain('borderRadius: 12');
    expect(styleBlock(ssh, 'statusDot')).toContain('borderRadius: 3.5');
    for (const name of ['rowIcon', 'rowAction']) {
      expect(styleBlock(read('ssh-host-row'), name)).toContain('borderRadius: 20');
    }
    for (const name of ['attachmentImageWrapper', 'attachmentThumbnail']) {
      expect(styleBlock(read('agent-message-block'), name)).toContain('borderRadius: 14');
    }
    expect(styleBlock(read('update-status-banner'), 'icon')).toContain('borderRadius: 18');
  });
});
