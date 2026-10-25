import { EMPTY_CATALOG, type AgentCatalog } from './agent-protocol';
import type { FileMentionHit } from './file-mentions';

/** Catalog and files for the existing offline /demo/muqun workbench fixture. */
export function demoAgentComposerCatalog(): AgentCatalog {
  return {
    ...EMPTY_CATALOG,
    skills: [
      {
        id: 'offline-review',
        name: 'offline-review',
        description: 'Review the offline composer sample',
      },
    ],
  };
}

export function demoAgentComposerFiles(query = '', limit = 20): FileMentionHit[] {
  return [
    { path: 'app.json', name: 'app.json', kind: 'text' },
    { path: 'src/theme.ts', name: 'theme.ts', kind: 'text' },
  ]
    .filter((file) => file.path.includes(query))
    .slice(0, limit);
}
