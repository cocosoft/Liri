/**
 * TTS 插件化提供者系统
 *
 * 定义 TTS 提供者接口和注册表，支持插件式扩展。
 * 内置提供者：Edge（微软神经网络语音）、None（静默占位）。
 *
 * 用法：
 * ```ts
 * import { TTSRegistry, EdgeTTSProvider } from './ttsProvider';
 *
 * TTSRegistry.register(new EdgeTTSProvider());
 * await TTSRegistry.speak({ text: '你好', voice: 'zh-CN-XiaoxiaoNeural' });
 * ```
 */

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type {
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
  TTSProvider,
} from './ttsTypes';
export type {
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
  TTSProvider,
} from './ttsTypes';

import { EdgeTTSProvider } from './edgeTTSProvider';
export { EdgeTTSProvider };

const logger = new Logger({ level: LogLevel.INFO });

/**
 * TTS 提供者注册表
 */
export class TTSRegistry {
  private static providers: Map<string, TTSProvider> = new Map();
  private static defaultProviderName: string = '';

  /**
   * 注册 TTS 提供者
   */
  static register(provider: TTSProvider, setAsDefault: boolean = false): void {
    TTSRegistry.providers.set(provider.name, provider);
    if (TTSRegistry.providers.size === 1 || setAsDefault) {
      TTSRegistry.defaultProviderName = provider.name;
    }
  }

  /**
   * 注销 TTS 提供者
   */
  static unregister(name: string): void {
    TTSRegistry.providers.delete(name);
    if (TTSRegistry.defaultProviderName === name) {
      const firstProvider = TTSRegistry.providers.keys().next().value;
      TTSRegistry.defaultProviderName = firstProvider ?? '';
    }
  }

  /**
   * 获取 TTS 提供者
   */
  static getProvider(name?: string): TTSProvider | undefined {
    const providerName = name || TTSRegistry.defaultProviderName;
    return providerName ? TTSRegistry.providers.get(providerName) : undefined;
  }

  /**
   * 获取默认 TTS 提供者
   */
  static getDefaultProvider(): TTSProvider | undefined {
    return TTSRegistry.defaultProviderName
      ? TTSRegistry.providers.get(TTSRegistry.defaultProviderName)
      : undefined;
  }

  /**
   * 获取所有已注册的提供者名称
   */
  static getProviderNames(): string[] {
    return Array.from(TTSRegistry.providers.keys());
  }

  /**
   * 获取所有提供者的语音列表（按提供者分组）
   */
  static getAllVoices(): Map<string, TTSVoice[]> {
    const result = new Map<string, TTSVoice[]>();
    for (const [name, provider] of TTSRegistry.providers) {
      result.set(name, provider.getVoices());
    }
    return result;
  }

  /**
   * 合成语音
   */
  static async speak(
    options: TTSSpeakOptions,
    providerName?: string
  ): Promise<TTSSpeakResult> {
    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      const error = `TTSRegistry · Provider 不可用${providerName ? `: "${providerName}" 未注册` : '（无默认 Provider）'}`;
      logger.error(error, { providerName });
      return { success: false, error };
    }

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.registry.tts.speak',
        attributes: {
          provider: providerName ?? provider.name,
          textLength: options.text.length,
        },
      },
      async () => {
        try {
          const result = await provider.speak(options);
          if (!result.success) {
            logger.warn('TTSRegistry · 合成失败', {
              provider: provider.name,
              error: result.error,
            });
          }
          return result;
        } catch (error) {
          void handleError(error, {
            module: 'services:voice:ttsRegistry',
            action: 'speak',
            context: {
              provider: provider.name,
              textLength: options.text.length,
            },
          });
          return {
            success: false,
            error: `TTS 合成失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    )();
  }

  /**
   * 合成并保存到文件
   */
  static async save(
    options: TTSSpeakOptions & { filename: string },
    providerName?: string
  ): Promise<TTSSpeakResult> {
    const provider = TTSRegistry.getProvider(providerName);
    if (!provider) {
      const error = `TTSRegistry · 保存 Provider 不可用${providerName ? `: "${providerName}" 未注册` : '（无默认 Provider）'}`;
      logger.error(error, { providerName });
      return { success: false, error };
    }

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.registry.tts.save',
        attributes: {
          provider: provider.name,
          filename: options.filename,
          textLength: options.text.length,
        },
      },
      async () => {
        try {
          if (provider.save) {
            return await provider.save(options);
          }
          // Fallback: speak 后保存结果
          const result = await provider.speak(options);
          if (result.success && result.audioData) {
            const { writeFile } = await import('fs/promises');
            await writeFile(options.filename, result.audioData);
            return { ...result, filePath: options.filename };
          }
          return result;
        } catch (error) {
          void handleError(error, {
            module: 'services:voice:ttsRegistry',
            action: 'save',
            context: { provider: provider.name, filename: options.filename },
          });
          return {
            success: false,
            error: `TTS 保存失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    )();
  }

  /**
   * 停止所有提供者的语音输出
   */
  static stopAll(): void {
    for (const provider of TTSRegistry.providers.values()) {
      provider.stop?.();
    }
  }

  /**
   * 注册默认 TTS 提供者
   *
   * 注册 EdgeTTS（始终注册为默认），并可选注册额外提供者。
   * 额外提供者的自动检测由调用方（如 VoiceServiceBridge）负责，
   * 保持注册表与具体提供者解耦。
   *
   * @param extraProviders 额外注册的提供者列表
   * @returns 已注册的提供者名称列表
   */
  static registerDefaults(extraProviders?: TTSProvider[]): string[] {
    if (TTSRegistry.providers.size === 0) {
      TTSRegistry.register(new EdgeTTSProvider(), true);
    }

    if (extraProviders) {
      for (const provider of extraProviders) {
        if (!TTSRegistry.providers.has(provider.name)) {
          TTSRegistry.register(provider);
        }
      }
    }

    return TTSRegistry.getProviderNames();
  }

  /**
   * 清除所有注册的提供者
   */
  static clear(): void {
    TTSRegistry.providers.clear();
    TTSRegistry.defaultProviderName = '';
  }
}

// 默认注册 Edge TTS 提供者
TTSRegistry.register(new EdgeTTSProvider(), true);
