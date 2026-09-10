export interface PreviewPermission {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

export interface LocalPreviewPorts {
  enabled: () => boolean;
  prepare: () => Promise<unknown>;
  permission: () => Promise<PreviewPermission>;
  requestPermission: () => Promise<PreviewPermission>;
  schedule: (request: {
    content: { title: string; body: string; data: { url: '/settings' } };
    trigger: null;
  }) => Promise<string>;
}

/** Route focus, not AppState: a system permission sheet must not cancel its own request. */
export class LocalPreviewFocus {
  private owner: symbol | null = null;

  activate(): () => void {
    const owner = Symbol('notification-preview-focus');
    this.owner = owner;
    return () => {
      if (this.owner === owner) this.owner = null;
    };
  }

  capture(): () => boolean {
    const owner = this.owner;
    return () => owner !== null && this.owner === owner;
  }
}

/** One explicit tap, one local delivery attempt; no push tokens or remote ports. */
export class LocalNotificationPreview {
  private busy = false;

  async run(
    ports: LocalPreviewPorts,
    content: { title: string; body: string }
  ): Promise<'busy' | 'disabled' | 'permission-denied' | 'scheduled'> {
    if (this.busy) return 'busy';
    if (!ports.enabled()) return 'disabled';
    this.busy = true;
    try {
      await ports.prepare();
      if (!ports.enabled()) return 'disabled';
      let permission = await ports.permission();
      if (!ports.enabled()) return 'disabled';
      // A previous denial is a decision, not an invitation to prompt again.
      if (!permission.granted && permission.status === 'undetermined' && permission.canAskAgain) {
        if (!ports.enabled()) return 'disabled';
        permission = await ports.requestPermission();
      }
      // Settings may change or the screen may leave while permission UI is open.
      if (!ports.enabled()) return 'disabled';
      if (!permission.granted) return 'permission-denied';
      await ports.schedule({ content: { ...content, data: { url: '/settings' } }, trigger: null });
      return 'scheduled';
    } finally {
      this.busy = false;
    }
  }
}
