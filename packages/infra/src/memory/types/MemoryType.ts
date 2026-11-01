/**
 * 记忆类型
 * 封闭类型枚举，通过 registerMemoryType 扩展
 */
export enum MemoryType {
  USER_FACT = 'user_fact',
  USER_PREFERENCE = 'user_preference',
  PROJECT_KNOWLEDGE = 'project_knowledge',
  CODE_PATTERN = 'code_pattern',
  DECISION = 'decision',
  /** P2-5: 用户反馈 — 用户对 Agent 输出的评价 */
  FEEDBACK = 'feedback',
  /** P2-5: 参考材料 — 外部文档、URL、数据源摘要 */
  REFERENCE = 'reference',
}

/**
 * 类型语义描述
 */
export interface MemoryTypeSemantics {
  whenToSave: string;
  howToUse: string;
}

const MEMORY_TYPE_SEMANTICS: Record<MemoryType, MemoryTypeSemantics> = {
  [MemoryType.USER_FACT]: {
    whenToSave: '用户事实 — 用户的角色、团队、姓名、工作方式、上下文信息',
    howToUse: '在回答中参考用户身份和背景，提供个性化回复',
  },
  [MemoryType.USER_PREFERENCE]: {
    whenToSave: '用户偏好 — 用户明确表达的喜好、厌恶、习惯',
    howToUse: '按用户偏好的风格、格式、方式提供服务',
  },
  [MemoryType.PROJECT_KNOWLEDGE]: {
    whenToSave: '项目知识 — 项目架构、配置、业务规则、技术选型',
    howToUse: '在涉及项目相关任务时自动注入，确保上下文一致性',
  },
  [MemoryType.CODE_PATTERN]: {
    whenToSave: '代码模式 — 项目中反复使用的代码约定、惯用法、架构模式',
    howToUse: '在生成或审查代码时参考，保持代码风格一致',
  },
  [MemoryType.DECISION]: {
    whenToSave: '技术决策 — 包含理由的重大架构或技术选择',
    howToUse: '在类似场景中复用决策理由，避免重复讨论',
  },
  [MemoryType.FEEDBACK]: {
    whenToSave: '用户反馈 — 用户对 Agent 输出的评价、纠正、偏好表达',
    howToUse: '在后续回复中参考用户反馈，改进输出质量和风格',
  },
  [MemoryType.REFERENCE]: {
    whenToSave: '参考材料 — 外部文档链接、数据源摘要、API 文档片段',
    howToUse: '在需要时引用参考材料作为权威信息来源',
  },
};

const WHAT_NOT_TO_SAVE: string[] = [
  '代码片段 — 可直接从文件中获取，不应重复存储',
  'Git 历史 — git log 更权威，无需记忆',
  '临时任务细节 — 一次性任务细节无长期价值',
  '.trae/rules/ 中已有的信息 — 规则文件为权威来源',
];

/**
 * 获取指定类型的语义描述
 */
export function getTypeSemantics(type: MemoryType): MemoryTypeSemantics {
  return MEMORY_TYPE_SEMANTICS[type];
}

/**
 * 获取所有类型的语义描述
 */
export function getAllTypeSemantics(): Record<MemoryType, MemoryTypeSemantics> {
  return { ...MEMORY_TYPE_SEMANTICS };
}

/**
 * 获取不应保存的信息类型说明
 */
export function getWhatNotToSave(): string[] {
  return [...WHAT_NOT_TO_SAVE];
}

/**
 * 验证记忆类型是否有效
 */
export function isValidMemoryType(type: string): type is MemoryType {
  const registered = new Set([
    ...Object.values(MemoryType),
    ...customTypeRegistry.keys(),
  ]);
  return registered.has(type as MemoryType);
}

/**
 * P2-5: 为记忆类型生成 XML 格式模板
 * 对标 hermes-agent memory XML format
 */
export function renderMemoryXMLTemplate(
  type: MemoryType,
  content: string
): string {
  const semantics = MEMORY_TYPE_SEMANTICS[type];
  if (!semantics) return content;

  return [
    `<memory type="${type}">`,
    `  <content>${escapeXml(content)}</content>`,
    `  <save_rule>${escapeXml(semantics.whenToSave)}</save_rule>`,
    `  <use_rule>${escapeXml(semantics.howToUse)}</use_rule>`,
    `</memory>`,
  ].join('\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 验证记忆内容是否属于禁止保存的类别
 * @param content 记忆内容
 * @returns 是否允许保存
 */
export function isAllowedMemoryContent(content: string): boolean {
  const normalized = content.toLowerCase();
  const blockPatterns = [
    /^git\s+(log|diff|status|branch|commit)/,
    /^```[\s\S]*```$/,
  ];
  return !blockPatterns.some((p) => p.test(normalized));
}

const customTypeRegistry = new Map<string, MemoryTypeSemantics>();

/**
 * 注册自定义记忆类型（插件扩展用）
 * @param type 自定义类型名称
 * @param semantics 语义描述
 */
export function registerMemoryType(
  type: string,
  semantics: MemoryTypeSemantics
): void {
  customTypeRegistry.set(type, semantics);
}

/**
 * 获取所有已注册的自定义类型
 */
export function getRegisteredCustomTypes(): Map<string, MemoryTypeSemantics> {
  return new Map(customTypeRegistry);
}
