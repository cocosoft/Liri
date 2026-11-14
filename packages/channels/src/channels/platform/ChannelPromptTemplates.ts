/**
 * ChannelPromptTemplates — 平台格式化提示模板
 *
 * P2-16: 补齐 SMS/LINE/IRC 3 个平台的格式化指令。
 * 当 AI 通过这些渠道回复时，自动注入对应格式规则到 System Prompt。
 *
 * 模板按渠道 ID 索引，在 PromptAssembler 的 platform_prompt 段落中注入。
 */
export interface ChannelPrompt {
  /** 渠道 ID */
  channelId: string;
  /** 最大消息长度（字符数） */
  maxLength: number;
  /** 格式限制说明 */
  formatRules: string;
  /** 是否支持 Markdown */
  markdownSupported: boolean;
}

/** SMS 平台提示 — 纯文本、≤160字符分段、Emoji友好 */
const SMS_PROMPT: ChannelPrompt = {
  channelId: 'sms',
  maxLength: 160,
  markdownSupported: false,
  formatRules: [
    'SMS 短信限制：每条消息 ≤160 字符，超长消息会被自动分段',
    '禁止使用 Markdown 语法（**加粗**、- 列表、`code` 等）',
    '使用纯文本回复，优先简短精炼',
    '每段回复控制在 ≤140 字符（预留 20 字符分段标记）',
    '可使用 Emoji 增强表达，但避免过度使用',
  ].join('；'),
};

/** LINE 平台提示 — 支持部分 Markdown、Sticker、≤5000字符 */
const LINE_PROMPT: ChannelPrompt = {
  channelId: 'line',
  maxLength: 5000,
  markdownSupported: true,
  formatRules: [
    'LINE 消息限制：每条消息 ≤5000 字符',
    '支持 Markdown 语法：**加粗**、*斜体*、`行内代码`、\n换行',
    '代码块用 ```包围```（LINE 原生支持代码块渲染）',
    '不支持 Markdown 表格、任务列表、HTML 标签',
    '可使用 Emoji 和 LINE Sticker（如需发送 Sticker，用 sticker:xxx 格式标注）',
    '长回复优先分段，避免单条消息过于冗长',
  ].join('；'),
};

/** IRC 平台提示 — 纯文本、无Markdown、命令式风格 */
const IRC_PROMPT: ChannelPrompt = {
  channelId: 'irc',
  maxLength: 400,
  markdownSupported: false,
  formatRules: [
    'IRC 聊天规则：每条消息 ≤400 字符（部分网络更低）',
    '禁止使用 Markdown 语法，纯文本回复',
    'IRC 不支持 Markdown 表格、代码块、图片嵌入',
    '代码片段用缩进表示（每行 2 空格前缀）',
    '回复风格偏对话式，避免长篇大论',
    '可使用 /me 动作命令（第三人称叙述）标注关键动作',
    '用户提及用昵称加冒号（如 nick: 消息内容）',
  ].join('；'),
};

/** 所有平台提示索引 */
const CHANNEL_PROMPTS: Record<string, ChannelPrompt> = {
  sms: SMS_PROMPT,
  line: LINE_PROMPT,
  irc: IRC_PROMPT,
};

/**
 * 获取指定渠道的格式化提示模板
 * @param channelId 渠道 ID（如 'sms', 'line', 'irc'）
 * @returns 渠道提示模板，未匹配到则返回 null
 */
export function getChannelPrompt(channelId: string): ChannelPrompt | null {
  return CHANNEL_PROMPTS[channelId] ?? null;
}

/**
 * 获取所有已注册的渠道提示
 */
export function getAllChannelPrompts(): Record<string, ChannelPrompt> {
  return { ...CHANNEL_PROMPTS };
}

/**
 * 将渠道提示渲染为 System Prompt 段落
 * @param channelId 渠道 ID
 * @returns 渲染后的提示段落文本，无匹配则返回 null
 */
export function renderChannelPrompt(channelId: string): string | null {
  const prompt = getChannelPrompt(channelId);
  if (!prompt) return null;

  return [
    `## 当前回复渠道：${channelId}`,
    `消息长度上限：${prompt.maxLength} 字符`,
    `Markdown 支持：${prompt.markdownSupported ? '是' : '否'}`,
    '',
    '请严格遵循以下渠道回复规则：',
    prompt.formatRules,
  ].join('\n');
}

/**
 * 注册新的渠道提示（插件扩展用）
 */
export function registerChannelPrompt(prompt: ChannelPrompt): void {
  CHANNEL_PROMPTS[prompt.channelId] = prompt;
}
