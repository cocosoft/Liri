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
    displayName: '用户画像',
    scope: 'global',
    description: '用户身份、偏好、沟通风格与技术背景。',
    whenToSave: '当用户分享个人偏好、纠正你的做法，或显露其工作习惯时。',
    howToUse: '主动据此定制回复方式、工具选择与沟通语气。',
    examples: [
      '用户偏好 TypeScript 而非 Python',
      '用户要求用中文回复',
      '偏好简洁回答、不要表情符号',
    ],
  },
  {
    type: 'feedback',
    displayName: '反馈与纠正',
    scope: 'workspace',
    description: '来自用户的行为指导 —— 纠正、肯定与偏好。',
    whenToSave: '当用户明确纠正你，或称赞某种具体做法时。',
    howToUse: '立即调整后续行为，优先级高于项目知识。',
    examples: ['“这个别用 docker” → 记为反馈', '“那个做法很好” → 记为肯定'],
  },
  {
    type: 'project',
    displayName: '项目知识',
    scope: 'workspace',
    description: '项目特有上下文：架构、决策、截止时间、事故。',
    whenToSave: '在重要的架构决策、缺陷发现或里程碑完成之后。',
    howToUse: '在处理同一项目时参考。不要保存可从仓库推导出的代码。',
    examples: [
      '“我们之所以选 SQLite 是因为……” → 记录该决策',
      '截止时间是下周五 → 记录该约束',
    ],
  },
  {
    type: 'reference',
    displayName: '外部引用',
    scope: 'workspace',
    description:
      '指向外部系统的指针：Linear 工单、Grafana 仪表盘、Slack 频道、文档。',
    whenToSave: '当用户提到相关的外部系统或文档时。',
    howToUse: '在用户问及相关话题时作为检索键使用。保持 URL / 句柄简短。',
    examples: [
      'Linear 项目：LIN-1234',
      'Grafana 仪表盘：/d/xyz',
      '设计文档：https://...',
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
