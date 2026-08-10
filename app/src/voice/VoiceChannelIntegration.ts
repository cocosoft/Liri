/**
 * VoiceChannelIntegration
 * 语音通道集成层
 * 将 VoiceServiceBridge 的能力暴露给消息通道系统（channels/）
 * 提供 TTS 语音消息发送、语音可用性查询等通道级能力
 */

import { TTSRegistry } from '../services/voice/services/ttsProvider';
import {
  detectRuntimeEnvironment,
  isVoiceAvailable,
} from '../services/voice/services/environmentRuntimeDetector';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('voice:channelIntegration');

/** 通道语音配置 */
export interface VoiceChannelConfig {
  /** 默认 TTS 提供者名称 */
  defaultTTSProvider?: string;
  /** 默认语音 */
  defaultVoice?: string;
  /** 默认语速 */
  defaultSpeed?: number;
}

/** 通道语音消息发送选项 */
export interface VoiceChannelMessageOptions {
  text: string;
  voice?: string;
  speed?: number;
  provider?: string;
  /** 是否等待播放完成 */
  waitForCompletion?: boolean;
}

/** 通道语音状态 */
export interface VoiceChannelStatus {
  available: boolean;
  ttsProviders: string[];
  currentProvider: string | null;
  runtimeEnvironment: string;
}

/**
 * 语音通道集成
 * 为消息通道系统提供语音能力：
 * - TTS 语音消息发送（播放到本地扬声器）
 * - 语音可用性查询
 * - 多 TTS 提供者切换
 */
export class VoiceChannelIntegration {
  private config: VoiceChannelConfig;
  private currentProvider: string | null = null;

  constructor(config?: VoiceChannelConfig) {
    this.config = {
      defaultTTSProvider: TTSRegistry.getDefaultProvider()?.name,
      defaultVoice: 'default',
      defaultSpeed: 1.0,
      ...config,
    };
    this.currentProvider = this.config.defaultTTSProvider ?? null;
  }

  /**
   * 发送语音消息（TTS 播放到扬声器）
   * 不阻塞调用方，除非 waitForCompletion 为 true
   */
  async sendVoiceMessage(
    options: VoiceChannelMessageOptions
  ): Promise<{ success: boolean; error?: string }> {
    if (!isVoiceAvailable()) {
      return { success: false, error: '当前环境不支持语音输出' };
    }

    const providerName = options.provider || this.currentProvider || undefined;

    try {
      const result = await TTSRegistry.speak(
        {
          text: options.text,
          voice: options.voice || this.config.defaultVoice,
          speed: options.speed ?? this.config.defaultSpeed,
        },
        providerName
      );

      if (!result.success) {
        logger.warning('TTS 语音消息发送失败', {
          error: result.error,
          provider: providerName,
        });
      }

      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      void handleError(error, {
        module: 'voice:channel',
        action: 'sendVoiceMessage',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('TTS 语音消息发送异常', { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 获取当前 TTS 提供者
   */
  getCurrentProvider(): string | null {
    return this.currentProvider;
  }

  /**
   * 切换 TTS 提供者
   */
  setProvider(name: string): boolean {
    const provider = TTSRegistry.getProvider(name);
    if (provider) {
      this.currentProvider = name;
      logger.info('TTS 提供者已切换', { provider: name });
      return true;
    }
    return false;
  }

  /**
   * 获取支持的 TTS 提供者列表
   */
  getProviders(): string[] {
    return TTSRegistry.getProviderNames();
  }

  /**
   * 获取通道语音状态
   */
  getStatus(): VoiceChannelStatus {
    return {
      available: isVoiceAvailable(),
      ttsProviders: TTSRegistry.getProviderNames(),
      currentProvider: this.currentProvider,
      runtimeEnvironment: detectRuntimeEnvironment().environment,
    };
  }
}
