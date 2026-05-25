/**
 * BlueBubbles 通道运行时
 */

import type { ChannelMessageToolHints } from '@modules/channels/types';

export const BLUEBUBBLES_TOOL_HINTS: ChannelMessageToolHints = {
  responsePreference: 'detailed',
  formattingTips: [
    'iMessage 支持富文本格式：**粗体** *斜体*',
    '发送链接会自动生成预览卡片',
    '支持发送表情符号反应（Tapback）',
    'Apple ID 邮箱地址可作为发送目标',
    '手机号格式：+861234567890',
  ],
  recommendedMaxLength: 4000,
  platformCapabilities: [
    'rich_text',
    'tapback_reaction',
    'file_upload',
    'image',
    'link_preview',
    'group_chat',
  ],
  constraints: [
    '需要 macOS 设备运行 BlueBubbles Server',
    'iMessage 仅在 Apple 设备间可用',
  ],
};

export interface BlueBubblesRuntimeContext {
  serverUrl: string;
  homeHandle?: string;
  deviceName?: string;
  accountId?: string;
}

export function buildBlueBubblesContext(ctx: BlueBubblesRuntimeContext): string {
  const parts: string[] = ['[BlueBubbles/iMessage Platform Context]'];
  parts.push(`服务器: ${ctx.serverUrl}`);
  if (ctx.homeHandle) parts.push(`默认号码: ${ctx.homeHandle}`);
  if (ctx.deviceName) parts.push(`设备: ${ctx.deviceName}`);

  if (BLUEBUBBLES_TOOL_HINTS.formattingTips) {
    parts.push('格式提示:');
    for (const tip of BLUEBUBBLES_TOOL_HINTS.formattingTips) {
      parts.push(`  - ${tip}`);
    }
  }

  return parts.join('\n');
}
