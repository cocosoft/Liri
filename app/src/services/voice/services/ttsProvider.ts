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

/** TTS 语音信息 */
export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female';
}

/** TTS 合成选项 */
export interface TTSSpeakOptions {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
}

/** TTS 合成结果 */
export interface TTSSpeakResult {
  /** 是否成功 */
  success: boolean;
  /** 音频时长（秒），仅 speak 动作返回 */
  audioDurationSec?: number;
  /** 音频二进制数据 */
  audioData?: Buffer;
  /** 音频文件路径，仅 save 动作返回 */
  filePath?: string;
  /** 语音信息 */
  voice?: TTSVoice;
  /** 错误信息 */
  error?: string;
}

/** TTS 提供者接口 */
export interface TTSProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 获取支持的语音列表 */
  getVoices(): TTSVoice[];
  /** 合成语音 */
  speak(options: TTSSpeakOptions): Promise<TTSSpeakResult>;
  /** 合成并保存到文件 */
  save?(
    options: TTSSpeakOptions & { filename: string }
  ): Promise<TTSSpeakResult>;
  /** 停止合成 */
  stop?(): void;
}

import { EdgeTTSProvider } from './edgeTTSProvider';
export { EdgeTTSProvider };

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
      return {
        success: false,
        error: `No TTS provider available${providerName ? `: "${providerName}" not found` : ''}`,
      };
    }
    return provider.speak(options);
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
      return {
        success: false,
        error: `No TTS provider available${providerName ? `: "${providerName}" not found` : ''}`,
      };
    }
    if (!provider.save) {
      // Fallback: speak 后保存结果
      return provider.speak(options).then((r) => ({
        ...r,
        filePath: options.filename,
      }));
    }
    return provider.save(options);
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
