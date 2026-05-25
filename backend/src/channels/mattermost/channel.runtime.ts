/**
 * Mattermost 通道运行时
 * 处理消息格式转换、工具提示、多账号分发
 */

import type { MattermostProbe } from './probe';
import type { ChannelMessageToolHints } from '@modules/channels/types';

export const MATTERMOST_TOOL_HINTS: ChannelMessageToolHints = {
  responsePreference: 'markdown',
  formattingTips: [
    'Mattermost 支持 Markdown 格式：**粗体** *斜体* `代码`',
    '使用 ~strikethrough~ 表示删除线',
    '使用 :emoji: 格式引用表情符号',
    '@mention 用户名可触发通知',
    '链接直接粘贴即可自动解析',
  ],
  recommendedMaxLength: 4000,
  platformCapabilities: [
    'markdown',
    'mention',
    'emoji',
    'file_upload',
    'image',
    'thread_reply',
    'reactions',
  ],
  constraints: ['Mattermost 消息最大长度 16383 字符，推荐 4000 以内'],
};

export interface MattermostRuntimeContext {
  serverUrl: string;
  botToken: string;
  botUserId?: string;
  botUsername?: string;
  accountId?: string;
}

/**
 * 构建 Mattermost LLM 平台上下文
 */
export function buildMattermostContext(
  ctx: MattermostRuntimeContext
): string {
  const parts: string[] = ['[Mattermost Platform Context]'];
  parts.push(`服务器: ${ctx.serverUrl}`);
  if (ctx.botUsername) parts.push(`Bot: @${ctx.botUsername}`);
  if (ctx.accountId) parts.push(`账号: ${ctx.accountId}`);

  if (MATTERMOST_TOOL_HINTS.formattingTips) {
    parts.push('格式提示:');
    for (const tip of MATTERMOST_TOOL_HINTS.formattingTips) {
      parts.push(`  - ${tip}`);
    }
  }

  return parts.join('\n');
}
