/**
 * Voice命令
 * 切换语音模式开关
 *
 * 对标 CC 源码 cc_code/backend/commands/voice/voice.ts
 * CC 中的 /voice 是纯 toggle，Liri 扩展为带子命令的形式：
 * /voice enable / disable / status / help
 */

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import type { CommandContext } from '@modules/commands';
import { createVoiceServiceBridge } from '../../../voice/VoiceServiceBridge';

const logger = getLogger('commands:voice');

/**
 * 语音命令实现
 */
const voiceCommand = {
  async execute(args: string, _context: CommandContext) {
    const subcommand = args.trim().toLowerCase();

    if (subcommand === 'help') {
      return {
        success: true,
        message: [
          '语音模式帮助',
          '==============',
          '',
          '切换语音模式的启用/禁用。启用后可通过快捷键录音输入。',
          '',
          '用法:',
          '  /voice              - 切换语音模式开关',
          '  /voice enable       - 启用语音模式',
          '  /voice disable      - 禁用语音模式',
          '  /voice status       - 显示语音模式状态',
          '  /voice help         - 显示本帮助',
          '',
          '子命令别名:',
          '  enable  同义词: on',
          '  disable 同义词: off',
          '',
          '功能说明:',
          '  语音输入         - 按住快捷键开始录音，松开后自动识别',
          '  语音输出         - 自动朗读回复内容',
          '  实时语音会话     - 通过 WebSocket (/voice) 端点建立实时语音双工通信',
          '  通道语音集成     - Telegram 语音消息自动下载识别，Discord 语音频道加入/离开',
          '  TTS 提供商       - EdgeTTS（免费）、OpenAI TTS、Command TTS',
          '',
          '系统要求:',
          '  - Windows: 使用 PowerShell 录音（无需额外工具）',
          '  - macOS:   需要安装 SoX（brew install sox）',
          '  - Linux:   需要 SoX 或 ALSA arecord',
          '',
          '当前状态: ' + getVoiceStatus(),
        ].join('\n'),
      };
    }

    const config = configManager.getGlobalConfig();
    const isEnabled = config.voiceEnabled === true;

    try {
      if (subcommand === 'status') {
        return handleStatus(isEnabled);
      }

      if (subcommand === 'disable' || subcommand === 'off') {
        return handleDisable(config);
      }

      if (subcommand === 'enable' || subcommand === 'on') {
        return handleEnable(config);
      }

      if (!subcommand) {
        const newMode = !isEnabled;
        return newMode ? handleEnable(config) : handleDisable(config);
      }

      return {
        success: true,
        message:
          '未知参数 "' +
          subcommand +
          '"。\n用法: /voice [enable|disable|status|help]',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('语音命令执行失败', {
        error: errorMsg,
        subcommand: args.trim().toLowerCase(),
      });
      return {
        success: false,
        message: '操作失败: ' + errorMsg,
      };
    }
  },
};

/**
 * 处理 status 子命令
 */
async function handleStatus(isEnabled: boolean) {
  const bridge = createVoiceServiceBridge();
  const deps = await bridge.service.recorder.checkVoiceDependencies();
  const statusLines = [
    '语音模式状态',
    '==============',
    '',
    '状态: ' + (isEnabled ? '已启用' : '已禁用'),
    '录音工具: ' + (deps.available ? deps.method : '不可用'),
  ];

  if (!deps.available && deps.installCommand) {
    statusLines.push('安装提示: ' + deps.installCommand);
  }

  return {
    success: true,
    message: statusLines.join('\n'),
  };
}

/**
 * 处理 disable / off 子命令
 */
async function handleDisable(config: any) {
  if (config.voiceEnabled !== true) {
    return {
      success: true,
      message: '语音模式已经是禁用状态。',
    };
  }

  configManager.saveGlobalConfig((current: any) => ({
    ...current,
    voiceEnabled: false,
  }));

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_voice_toggled',
    {
      enabled: false,
      source: 'command',
    }
  );

  return {
    success: true,
    message: '语音模式已禁用。',
  };
}

/**
 * 处理 enable / on 子命令
 */
async function handleEnable(config: any) {
  if (config.voiceEnabled === true) {
    return {
      success: true,
      message: '语音模式已经是启用状态。',
    };
  }

  const bridge = createVoiceServiceBridge();
  const availability =
    await bridge.service.recorder.checkRecordingAvailability();
  if (!availability.available) {
    return {
      success: false,
      message:
        '语音模式不可用' +
        (availability.reason ? ': ' + availability.reason : '。'),
    };
  }

  const deps = await bridge.service.recorder.checkVoiceDependencies();
  if (!deps.available) {
    return {
      success: false,
      message:
        '未找到录音工具。' +
        (deps.installCommand ? '\n安装: ' + deps.installCommand : ''),
    };
  }

  configManager.saveGlobalConfig((current: any) => ({
    ...current,
    voiceEnabled: true,
  }));

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_voice_toggled',
    {
      enabled: true,
      source: 'command',
    }
  );

  return {
    success: true,
    message: '语音模式已启用。按住快捷键开始录音。',
  };
}

/**
 * 获取语音模式状态文本
 */
function getVoiceStatus(): string {
  try {
    const config = configManager.getGlobalConfig();
    return config.voiceEnabled === true ? '已启用' : '已禁用';
  } catch {
    return '未知';
  }
}

export default voiceCommand;
