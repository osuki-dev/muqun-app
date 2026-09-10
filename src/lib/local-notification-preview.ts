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
      // A previous denial is a decision, not an invitation to prompt again.
      if (!permission.granted && permission.status === 'undetermined' && permission.canAskAgain) {
        if (!ports.enabled()) return 'disabled';
        permission = await ports.requestPermission();
      }
      if (!permission.granted) return 'permission-denied';
      // Settings may change or the screen may leave while permission UI is open.
      if (!ports.enabled()) return 'disabled';
      await ports.schedule({ content: { ...content, data: { url: '/settings' } }, trigger: null });
      return 'scheduled';
    } finally {
      this.busy = false;
    }
  }
}
