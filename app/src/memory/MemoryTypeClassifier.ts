/**
 * MemoryTypeClassifier — 记忆 4 类型分类体系
 *
 * P2-5: 对标 cc_code memoryTypes.ts 四分类法。
 * 每种类型有 XML 格式 template（description/when_to_save/how_to_use/examples）。
 */
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryTypeTemplate {
  type: MemoryType;
  displayName: string;
  scope: 'global' | 'workspace' | 'session';
  description: string;
  whenToSave: string;
  howToUse: string;
  examples: string[];
}

export const MEMORY_TYPE_TEMPLATES: MemoryTypeTemplate[] = [
  {
    type: 'user',
    displayName: 'User Profile',
    scope: 'global',
    description:
      'User identity, preferences, communication style, and technical background.',
    whenToSave:
      'When the user shares personal preferences, corrects your approach, or reveals work patterns.',
    howToUse:
      'Apply proactively to customize responses, tool choices, and communication tone.',
    examples: [
      'User prefers TypeScript over Python',
      '用户要求用中文回复',
      'Prefers concise answers without emojis',
    ],
  },
  {
    type: 'feedback',
    displayName: 'Feedback & Corrections',
    scope: 'workspace',
    description:
      'Behavioral guidance from the user — corrections, affirmations, and preferences.',
    whenToSave:
      'When the user explicitly corrects you or praises a specific approach.',
    howToUse:
      'Adjust future behavior immediately. Higher priority than project knowledge.',
    examples: [
      '"Don\'t use docker for this" → add feedback',
      '"That approach was perfect" → affirm',
    ],
  },
  {
    type: 'project',
    displayName: 'Project Knowledge',
    scope: 'workspace',
    description:
      'Project-specific context: architecture, decisions, deadlines, incidents.',
    whenToSave:
      'After important architectural decisions, bug discoveries, or milestone completions.',
    howToUse:
      'Reference when working on the same project. Do NOT save code that can be derived from the repo.',
    examples: [
      '"We chose SQLite because..." → record decision',
      'Deadline is next Friday → record constraint',
    ],
  },
  {
    type: 'reference',
    displayName: 'External References',
    scope: 'workspace',
    description:
      'Pointers to external systems: Linear tickets, Grafana dashboards, Slack channels, docs.',
    whenToSave:
      'When the user mentions a relevant external system or document.',
    howToUse:
      'Use as lookup key when the user asks about related topics. Keep URLs/handles short.',
    examples: [
      'Linear project: LIN-1234',
      'Grafana dashboard: /d/xyz',
      'Design doc: https://...',
    ],
  },
];

/** P2-5: 根据文本内容分类记忆类型 */
export function classifyMemoryType(text: string): MemoryType {
  const lower = text.toLowerCase();
  if (
    /(?:don'?t|never|always|prefer|i like|please|you should|stop)/i.test(text)
  ) {
    if (/(?:good|great|perfect|thanks|exactly|nice)/i.test(text))
      return 'feedback';
    if (/(?:wrong|incorrect|mistake|bad|nope|not that|actually)/i.test(text))
      return 'feedback';
  }
  if (
    /(?:i am|i'?m|my |i work|i use|i prefer|i speak|my background|my name)/i.test(
      text
    )
  )
    return 'user';
  if (
    /(?:https?:\/\/|\.com|dashboard|ticket|issue|#\d+|linear|jira|grafana|slack|docs)/i.test(
      text
    )
  )
    return 'reference';
  return 'project';
}

/** P2-5: 获取类型的 XML template */
export function getMemoryTypeTemplate(type: MemoryType): MemoryTypeTemplate {
  return MEMORY_TYPE_TEMPLATES.find((t) => t.type === type)!;
}

/** P2-5: 生成类型标识（用于文件命名和注入） */
export function getMemoryTypeTag(type: MemoryType): string {
  return `<!-- memory-type: ${type} -->`;
}
