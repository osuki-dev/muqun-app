import type { AgentSessionSnapshot } from './agent-protocol';

// Finite, synthetic 160×110 bitmaps: no photo library, filesystem or network access.
const IMAGES = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABuCAIAAAAvT4++AAABGElEQVR4nO3RAQkAIBDAwE9qBIObwhQijIMLMNicvQib7wU8ZXCcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcdwHcY6dchfJfggAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABuCAIAAAAvT4++AAABGElEQVR4nO3RAQkAIBDAwO9pLmPZyRQijIMLMNisfQib7wU8ZXCcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcdwFRV4i6BmGjdwAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABuCAIAAAAvT4++AAABGElEQVR4nO3RAQkAIBDAwI9qFQPZ0RQijIMLMNisswmb7wU8ZXCcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcdwHCq+i3+ceUeAAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABuCAIAAAAvT4++AAABGElEQVR4nO3RAQkAIBDAwC9oRCPZyRQijIMLMNicvQib7wU8ZXCcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcdwHg1OwcY26BjAAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABuCAIAAAAvT4++AAABGElEQVR4nO3RAQkAIBDAwA9uHZNYzBQijIMLMNjsdQib7wU8ZXCcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcZ3CcwXEGxxkcdwFFSQKfVvsTegAAAABJRU5ErkJggg==',
];

export function demoImageGallerySnapshot(asid: string): AgentSessionSnapshot | null {
  const match = /^demo-image-(gallery|attachments)-(1|2|3|5)$/.exec(asid);
  if (!match) return null;
  const attachments = match[1] === 'attachments';
  const images = IMAGES.slice(0, Number(match[2]));
  return {
    info: {
      asid,
      backend_session_id: asid,
      agent_id: 'opencode',
      model: null,
      title: 'Synthetic image gallery',
      directory: '/demo/muqun',
      status: 'idle',
      updated_ms: 1,
    },
    timeline: [
      {
        id: `${asid}-message`,
        message_id: `${asid}-message`,
        role: attachments ? 'user' : 'assistant',
        ordinal: 0,
        part: {
          type: 'text',
          text: attachments
            ? ''
            : images.map((uri, index) => `![QA gallery ${index + 1}](${uri})`).join('\n\n'),
        },
        ...(attachments ? { attachments: images } : {}),
        seq: 1,
        updated_ms: 1,
      },
    ],
    permissions: [],
    forms: [],
    inbox: [],
    seq: 1,
  };
}
