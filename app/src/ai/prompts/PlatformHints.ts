import type { ChannelMessageToolHints } from '@modules/channels/types';

/**
 * 平台格式提示 — 简短描述各平台格式规则
 * 用于在 AI 回复中插入上下文，告知当前对话所在平台的格式要求
 */
export const PLATFORM_HINTS: Record<string, string> = {
  telegram:
    'This conversation is happening on Telegram. Format messages with MarkdownV2.',
  discord:
    'This conversation is happening on Discord. Use ```code blocks``` and > quotes.',
  slack:
    'This conversation is happening on Slack. Use `code` and *bold* formatting.',
  wechat:
    'This conversation is happening on WeChat. Keep responses concise (max 2048 chars).',
  feishu:
    'This conversation is happening on Feishu. Use interactive cards where appropriate.',
  dingtalk:
    'This conversation is happening on DingTalk. Use markdown formatting.',
  wecom:
    'This conversation is happening on WeChat Work. Keep responses concise (max 2048 chars).',
  qq: 'This conversation is happening on QQ. Keep responses concise (max 4096 chars).',
  whatsapp:
    'This conversation is happening on WhatsApp. Keep responses brief and mobile-friendly.',
  signal:
    'This conversation is happening on Signal. Messages are end-to-end encrypted.',
  matrix:
    'This conversation is happening on Matrix. Format messages with HTML or Markdown.',
};

/**
 * 平台消息工具提示 — 每个通道的详细 LLM 指导
 * 对齐 OpenClaw agentPrompt.messageToolHints 设计理念
 */
export const PLATFORM_TOOL_HINTS: Record<string, ChannelMessageToolHints> = {
  telegram: {
    responsePreference: 'markdown',
    formattingTips: [
      '使用 MarkdownV2 格式：*bold* _italic_ `code`',
      '链接格式: [text](url)',
      '不支持 HTML 格式',
      '特殊字符需要转义：_ * [ ] ( ) ~ ` > # + - = | { } . !',
    ],
    recommendedMaxLength: 4000,
    platformCapabilities: [
      'markdown',
      'inline_keyboard',
      'file_upload',
      'image',
      'polling',
      'webhook',
    ],
    constraints: [
      '媒体文件需先上传到 Telegram 服务器',
      'MarkdownV2 格式要求严格转义',
    ],
  },

  discord: {
    responsePreference: 'detailed',
    formattingTips: [
      '支持 Markdown: **bold** *italic* `code` ```code block```',
      '支持 @mentions 提及用户',
      '使用 > 表示引用',
      '使用 Embed 发送结构化消息',
    ],
    recommendedMaxLength: 2000,
    platformCapabilities: [
      'embed',
      'slash_commands',
      'thread',
      'reaction',
      'file_upload',
      'image',
      'webhook',
    ],
    constraints: ['消息长度限制 2000 字符', '@everyone 和 @here 自动禁用'],
  },

  slack: {
    responsePreference: 'detailed',
    formattingTips: [
      '支持 Mrkdwn 格式：*bold* ~strike~ `code` ```code block```',
      '使用 <@USER_ID> 提及用户',
      '使用 <#CHANNEL_ID> 提及频道',
      '使用 :emoji: 发送表情',
    ],
    recommendedMaxLength: 40000,
    platformCapabilities: [
      'mrkdwn',
      'block_kit',
      'thread',
      'reaction',
      'file_upload',
      'image',
      'webhook',
    ],
    constraints: ['Block Kit 消息结构复杂，优先使用简单文本'],
  },

  feishu: {
    responsePreference: 'card',
    formattingTips: [
      '支持 Markdown 格式',
      '优先使用 interactive card 展示结构化信息',
      '卡片支持按钮交互',
    ],
    recommendedMaxLength: 4096,
    platformCapabilities: [
      'markdown',
      'interactive_card',
      'streaming_card',
      'webhook',
      'websocket',
      'approval_auth',
      'file_upload',
      'image',
    ],
    constraints: ['卡片消息比纯文本更复杂但交互性更好'],
  },

  qq: {
    responsePreference: 'concise',
    formattingTips: ['支持 Markdown 格式', '支持 Ark 消息卡片', '保持回复简洁'],
    recommendedMaxLength: 4096,
    platformCapabilities: [
      'markdown',
      'ark_card',
      'image',
      'file_upload',
      'websocket',
    ],
    constraints: ['消息长度限制 4096 字符', 'WebSocket 协议需保持心跳'],
  },

  wechat: {
    responsePreference: 'concise',
    formattingTips: ['微信消息仅支持纯文本', '不可使用 Markdown 或 HTML'],
    recommendedMaxLength: 2048,
    platformCapabilities: ['text', 'image', 'webhook'],
    constraints: ['仅纯文本消息', '2048 字符限制'],
  },

  wecom: {
    responsePreference: 'concise',
    formattingTips: ['支持 Markdown 格式', '支持图文消息'],
    recommendedMaxLength: 2048,
    platformCapabilities: ['markdown', 'image', 'file_upload', 'webhook'],
    constraints: ['消息长度限制 2048 字符'],
  },

  dingtalk: {
    responsePreference: 'detailed',
    formattingTips: ['支持 Markdown 格式', '支持 ActionCard 消息卡片'],
    recommendedMaxLength: 4096,
    platformCapabilities: [
      'markdown',
      'action_card',
      'image',
      'file_upload',
      'webhook',
    ],
    constraints: ['消息长度限制 4096 字符'],
  },

  whatsapp: {
    responsePreference: 'concise',
    formattingTips: [
      'WhatsApp 消息简短为宜',
      '支持简单 Markdown：*bold* _italic_ ~strike~',
    ],
    recommendedMaxLength: 4096,
    platformCapabilities: [
      'text',
      'image',
      'file_upload',
      'interactive',
      'webhook',
    ],
    constraints: ['移动端阅读，回复宜简短', '模板消息需预先审核'],
  },

  signal: {
    responsePreference: 'concise',
    formattingTips: ['Signal 默认端到端加密', '支持 Markdown 格式'],
    recommendedMaxLength: 4096,
    platformCapabilities: ['text', 'image', 'file_upload', 'e2e_encrypted'],
    constraints: ['端到端加密，消息不可被服务端读取'],
  },

  matrix: {
    responsePreference: 'detailed',
    formattingTips: ['支持 HTML 格式', '支持 Markdown 格式', '支持富文本消息'],
    recommendedMaxLength: 65536,
    platformCapabilities: [
      'html',
      'markdown',
      'thread',
      'reaction',
      'file_upload',
      'image',
    ],
    constraints: ['消息长度可达 65536 字符'],
  },

  line: {
    responsePreference: 'concise',
    formattingTips: ['LINE 消息支持文本和图片', '支持 Flex Message 交互式消息'],
    recommendedMaxLength: 5000,
    platformCapabilities: [
      'text',
      'image',
      'file_upload',
      'flex_message',
      'webhook',
    ],
    constraints: ['Flex Message 实现较复杂'],
  },

  irc: {
    responsePreference: 'concise',
    formattingTips: [
      'IRC 仅支持纯文本',
      '不支持 Markdown 或 HTML',
      '消息长度限制 512 字符',
    ],
    recommendedMaxLength: 512,
    platformCapabilities: ['text', 'websocket'],
    constraints: ['纯文本协议，无富文本支持', '512 字符限制'],
  },

  email: {
    responsePreference: 'detailed',
    formattingTips: ['支持 HTML 和纯文本格式', '支持附件发送'],
    recommendedMaxLength: 100000,
    platformCapabilities: ['html', 'text', 'attachment', 'imap', 'smtp'],
    constraints: ['邮件发送可能有延迟', '附件大小受 SMTP 限制'],
  },

  sms: {
    responsePreference: 'concise',
    formattingTips: ['短信仅支持纯文本', '必须极度简短'],
    recommendedMaxLength: 160,
    platformCapabilities: ['text'],
    constraints: [
      '160 字符限制（单条短信）',
      '不支持富文本',
      '发送可能有运营商延迟',
    ],
  },
};

/**
 * 获取指定平台的工具提示
 */
export function getMessageToolHints(
  platform: string
): ChannelMessageToolHints | undefined {
  return PLATFORM_TOOL_HINTS[platform.toLowerCase()];
}

/**
 * 获取平台格式提示
 */
export function getPlatformHint(platform: string): string {
  return PLATFORM_HINTS[platform.toLowerCase()] || '';
}

/**
 * 构建完整平台上下文 — 组合格式提示 + 工具提示
 * 用于注入到 AI 系统提示中，让 LLM 生成适配各平台的消息
 */
export function buildPlatformContext(platform: string): string {
  const hint = getPlatformHint(platform);
  const toolHints = getMessageToolHints(platform);

  if (!hint && !toolHints) return '';

  const parts: string[] = [];

  if (hint) {
    parts.push(`[平台格式提示]\n${hint}`);
  }

  if (toolHints) {
    parts.push(`[消息生成指导]\nPlatform: ${platform}`);

    if (toolHints.responsePreference) {
      parts.push(`Response style: ${toolHints.responsePreference}`);
    }

    if (toolHints.formattingTips && toolHints.formattingTips.length > 0) {
      parts.push(
        'Formatting rules:\n- ' + toolHints.formattingTips.join('\n- ')
      );
    }

    if (toolHints.recommendedMaxLength) {
      parts.push(
        `Max message length: ${toolHints.recommendedMaxLength} characters`
      );
    }

    if (toolHints.constraints && toolHints.constraints.length > 0) {
      parts.push('Constraints:\n- ' + toolHints.constraints.join('\n- '));
    }
  }

  return parts.join('\n\n');
}

/**
 * 构建环境提示信息（注入系统提示，用于让 AI 了解运行环境）
 * 返回的信息包含 OS、Shell 等，末尾附加文件路径约束。
 * 注意：故意不注入 CWD，避免 AI 产生文件路径幻觉（BUG #9）。
 */
export function buildEnvironmentHints(): string {
  const hints: string[] = [];
  const isWindows = process.platform === 'win32';

  hints.push(`OS: ${process.platform}`);
  hints.push(
    `Shell: ${process.env['SHELL'] || process.env['ComSpec'] || 'unknown'}`
  );
  hints.push(`Date: ${new Date().toISOString()}`);

  const username = process.env['USER'] || process.env['USERNAME'];
  if (username) {
    hints.push(`User: ${username}`);
  }

  // === 平台特定约束 ===
  if (isWindows) {
    hints.push('');
    hints.push('--- WINDOWS COMMAND CONSTRAINTS ---');
    hints.push(
      'You are on Windows. The "bash" tool runs cmd.exe, NOT bash. Use Windows commands only.'
    );
    hints.push(
      'Unix commands NOT available: head, tail, sed, awk, xargs, tee, grep (use findstr), cat (use type)'
    );
    hints.push(
      'Paths: Use \\ separators and drive letters (C:\\...). /tmp does NOT exist — use %TEMP% or $env:TEMP'
    );
    hints.push(
      'For complex operations, use: powershell -Command "your PowerShell script"'
    );
    hints.push(
      'Git is available. Use: git clone https://... C:\\path\\to\\target'
    );
  }

  // === 文件路径约束（修复 BUG #9：AI 乱编文件路径）===
  hints.push('');
  hints.push('--- HARD CONSTRAINT: FILE PATHS ---');
  hints.push(
    '1. Only use file paths that have been confirmed via tool calls (read_file, write_file, glob, list_directory).'
  );
  hints.push(
    '2. Do NOT invent, guess, or assume file paths. If you are unsure, use search_codebase or glob to find the correct path.'
  );
  hints.push(
    '3. All paths must be absolute paths. Use the OS-appropriate path separators (\\ for Windows, / for macOS/Linux).'
  );
  hints.push(
    '4. If a tool call fails because a path does not exist, report the error to the user. Do not silently try alternative made-up paths.'
  );
  hints.push(
    '5. Every file path referenced in your text response must have been confirmed to exist via Read/Write/Glob/Edit tool calls during this conversation. If you are recommending a new file location, explicitly mark it with "(new file)".'
  );
  hints.push(
    '6. When working in a worktree environment, prefix path references with the worktree identifier (e.g., "in bridge-session123 app/src/file.ts") to avoid confusion with main repo files of the same name.'
  );

  return hints.join('\n');
}
