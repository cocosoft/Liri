/**
 * STT 提供者注册表
 *
 * 管理 STT 提供者的注册、查找和默认提供者切换。
 * 遵循与 TTSRegistry 相同的注册表模式。
 *
 * 用法：
 * ```ts
 * import { STTRegistry } from './sttRegistry';
 *
 * // 注册所有默认提供者
 * STTRegistry.registerDefaults();
 *
 * // 或手动注册
 * import { LocalSTTProvider } from './localSTTProvider';
 * STTRegistry.register(new LocalSTTProvider());
 *
 * const result = await STTRegistry.transcribe(audioBuffer);
 * ```
 */

import type { STTProvider, STTStreamConnection } from './sttProvider';
import type {
  STTResult,
  STTTranscribeOptions,
  STTStreamOptions,
} from '../models/types';

import { LocalSTTProvider } from './localSTTProvider';
import { CloudSTTProvider } from './cloudSTTProvider';
import { StreamSTTProvider } from './streamSTTProvider';

/**
 * STT 提供者注册表
 */
export class STTRegistry {
  private static providers: Map<string, STTProvider> = new Map();
  private static defaultProviderId: string = '';

  /**
   * 注册 STT 提供者
   * @param provider STT 提供者实例
   * @param setAsDefault 是否设置为默认提供者
   */
  static register(provider: STTProvider, setAsDefault: boolean = false): void {
    STTRegistry.providers.set(provider.id, provider);
    if (setAsDefault || !STTRegistry.defaultProviderId) {
      STTRegistry.defaultProviderId = provider.id;
    }
  }

  /**
   * 注销 STT 提供者
   * @param id 提供者 ID
   */
  static unregister(id: string): void {
    STTRegistry.providers.delete(id);
    if (STTRegistry.defaultProviderId === id) {
      const firstProvider = STTRegistry.providers.keys().next().value;
      STTRegistry.defaultProviderId = firstProvider ?? '';
    }
  }

  /**
   * 获取 STT 提供者
   * @param id 提供者 ID，不传则返回默认提供者
   * @returns 提供者实例，不存在时返回 undefined
   */
  static getProvider(id?: string): STTProvider | undefined {
    const providerId = id || STTRegistry.defaultProviderId;
    return providerId ? STTRegistry.providers.get(providerId) : undefined;
  }

  /**
   * 获取默认 STT 提供者
   * @returns 默认提供者实例
   */
  static getDefaultProvider(): STTProvider | undefined {
    return STTRegistry.defaultProviderId
      ? STTRegistry.providers.get(STTRegistry.defaultProviderId)
      : undefined;
  }

  /**
   * 设置默认提供者
   * @param id 提供者 ID
   */
  static setDefaultProvider(id: string): void {
    if (STTRegistry.providers.has(id)) {
      STTRegistry.defaultProviderId = id;
    }
  }

  /**
   * 获取所有已注册的提供者 ID 列表
   * @returns 提供者 ID 数组
   */
  static getProviderIds(): string[] {
    return Array.from(STTRegistry.providers.keys());
  }

  /**
   * 获取所有已注册的提供者列表
   * @returns 提供者实例数组
   */
  static getAllProviders(): STTProvider[] {
    return Array.from(STTRegistry.providers.values());
  }

  /**
   * 检查是否有可用的提供者
   * @returns true 表示至少有一个可用提供者
   */
  static hasAvailableProvider(): boolean {
    for (const provider of STTRegistry.providers.values()) {
      if (provider.isAvailable()) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取第一个可用的提供者
   * @returns 可用提供者实例，无可用时返回 undefined
   */
  static getFirstAvailableProvider(): STTProvider | undefined {
    for (const provider of STTRegistry.providers.values()) {
      if (provider.isAvailable()) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * 注册所有默认 STT 提供者
   *
   * 注册顺序：
   * 1. LocalSTTProvider — 本地 faster-whisper（如可用则设为默认）
   * 2. CloudSTTProvider — OpenAI Whisper API（如可用则设为默认）
   * 3. StreamSTTProvider — WebSocket 流式（如可用则设为默认）
   *
   * 优先级：local > cloud > stream（按可用性自动降级）
   *
   * @param cloudConfig CloudSTTProvider 配置（可选）
   * @param streamConfig StreamSTTProvider 配置（可选）
   */
  static registerDefaults(
    cloudConfig?: { apiKey?: string; baseUrl?: string },
    streamConfig?: { apiKey?: string; wsUrl?: string }
  ): void {
    const localProvider = new LocalSTTProvider();
    STTRegistry.register(localProvider);
    if (localProvider.isAvailable()) {
      STTRegistry.setDefaultProvider(localProvider.id);
    }

    if (cloudConfig?.apiKey) {
      const cloudProvider = new CloudSTTProvider({
        apiKey: cloudConfig.apiKey,
        baseUrl: cloudConfig.baseUrl,
      });
      STTRegistry.register(cloudProvider);
      if (cloudProvider.isAvailable()) {
        STTRegistry.setDefaultProvider(cloudProvider.id);
      }
    }

    if (streamConfig?.apiKey || streamConfig?.wsUrl) {
      const streamProvider = new StreamSTTProvider({
        apiKey: streamConfig.apiKey,
        wsUrl: streamConfig.wsUrl,
      });
      STTRegistry.register(streamProvider);
      if (streamProvider.isAvailable()) {
        STTRegistry.setDefaultProvider(streamProvider.id);
      }
    }
  }

  /**
   * 执行文件级转录
   * 按以下优先级选择提供者：
   * 1. 指定的提供者 ID
   * 2. 默认提供者
   * 3. 第一个可用的提供者
   *
   * @param audioData 音频数据
   * @param options 转录选项
   * @param providerId 指定提供者（可选）
   * @returns 转录结果
   */
  static async transcribe(
    audioData: Buffer,
    options?: STTTranscribeOptions,
    providerId?: string
  ): Promise<STTResult> {
    let provider =
      STTRegistry.getProvider(providerId) ||
      STTRegistry.getDefaultProvider() ||
      STTRegistry.getFirstAvailableProvider();

    if (provider && !provider.isAvailable()) {
      provider = STTRegistry.getFirstAvailableProvider();
    }

    if (!provider) {
      return {
        text: '',
        confidence: 0,
        isFinal: true,
        provider: undefined,
      };
    }

    return provider.transcribe(audioData, options);
  }

  /**
   * 创建流式转录连接
   * @param options 流式选项
   * @param providerId 指定提供者（可选）
   * @returns 流式连接，无可用提供者时返回 null
   */
  static createStream(
    options?: STTStreamOptions,
    providerId?: string
  ): STTStreamConnection | null {
    const provider =
      STTRegistry.getProvider(providerId) ||
      STTRegistry.getDefaultProvider() ||
      STTRegistry.getFirstAvailableProvider();

    if (!provider || !provider.createStream) {
      return null;
    }

    return provider.createStream(options);
  }

  /**
   * 获取可用的提供者列表（按优先级排序）
   * @returns 可用提供者实例数组
   */
  static getAvailableProviders(): STTProvider[] {
    return STTRegistry.getAllProviders().filter((p) => p.isAvailable());
  }
}
