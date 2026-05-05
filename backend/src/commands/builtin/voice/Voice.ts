/**
 * Voice命令
 * 切换语音模式开关
 *
 * 基于CC源码 cc_code/backend/commands/voice/voice.ts 实现
 */

import type { Command, CommandContext, CommandType } from '../../types';
import voiceService from '../../../services/voice';

export class VoiceCommand implements Command {
  type: CommandType = 'action';
  name = 'voice';
  description = '切换语音模式';
  aliases = ['voice-mode', '语音'];
  argumentHint = '[on|off]';

  async execute(args: string, context: CommandContext): Promise<{ success: boolean; message: string }> {
    const arg = args.trim().toLowerCase();

    const availability = await voiceService.checkRecordingAvailability();
    if (!availability.available) {
      return {
        success: false,
        message: `语音模式不可用: ${availability.reason}`,
      };
    }

    if (arg === 'off') {
      return {
        success: true,
        message: '语音模式已禁用',
      };
    }

    if (arg === 'on' || arg === '') {
      const deps = await voiceService.checkVoiceDependencies();
      if (!deps.available) {
        const hint = deps.installCommand
          ? `\n安装录音工具: ${deps.installCommand}`
          : '';
        return {
          success: false,
          message: `未找到录音工具。${hint}`,
        };
      }

      return {
        success: true,
        message: '语音模式已启用。按住快捷键开始录音。',
      };
    }

    return {
      success: true,
      message: '用法: /voice [on|off]\n\n选项:\n  on  - 启用语音模式\n  off - 禁用语音模式\n\n示例: /voice on',
    };
  }
}