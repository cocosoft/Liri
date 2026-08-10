/**
 * TTSConfigOverlay
 * TTS 多级配置覆盖系统
 *
 * 三层配置模型（优先级从低到高）：
 *   1. 全局默认配置（Global）
 *   2. 提供者默认配置（Provider）
 *   3. 单次调用配置（Call）
 *
 * 高层级配置会覆盖低层级中的同名属性。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { TTSSpeakOptions } from './ttsProvider';

const logger = getLogger('voice:ttsConfig');

/**
 * TTS 全局默认配置
 */
export interface TTSGlobalConfig {
  /** 默认语音 ID */
  defaultVoice?: string;
  /** 默认语速（1.0 为正常） */
  defaultSpeed?: number;
  /** 默认语言 */
  defaultLanguage?: string;
  /** 文本预处理开关 */
  textPreprocessing?: boolean;
}

/** 全局默认值 */
const GLOBAL_DEFAULTS: Required<TTSGlobalConfig> = {
  defaultVoice: '',
  defaultSpeed: 1.0,
  defaultLanguage: 'zh-CN',
  textPreprocessing: true,
};

/**
 * 解析后的完整配置
 */
export interface ResolvedTTSConfig {
  voice?: string;
  speed: number;
  language: string;
  textPreprocessing: boolean;
}

/**
 * TTS 多级配置管理器
 */
export class TTSConfigOverlay {
  private globalConfig: Required<TTSGlobalConfig>;

  /** 提供者特有默认配置 */
  private providerDefaults: Map<string, Partial<TTSSpeakOptions>> = new Map();

  constructor(globalConfig?: Partial<TTSGlobalConfig>) {
    this.globalConfig = { ...GLOBAL_DEFAULTS, ...globalConfig };
  }

  /**
   * 更新全局配置
   */
  updateGlobal(config: Partial<TTSGlobalConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...config };
    logger.debug('TTSConfigOverlay · 更新全局配置', { config });
  }

  /**
   * 获取全局配置
   */
  getGlobal(): Required<TTSGlobalConfig> {
    return { ...this.globalConfig };
  }

  /**
   * 设置提供者特有默认配置
   */
  setProviderDefaults(
    providerName: string,
    defaults: Partial<TTSSpeakOptions>
  ): void {
    this.providerDefaults.set(providerName, { ...defaults });
  }

  /**
   * 获取提供者特有默认配置
   */
  getProviderDefaults(
    providerName: string
  ): Partial<TTSSpeakOptions> | undefined {
    return this.providerDefaults.get(providerName);
  }

  /**
   * 移除提供者特有默认配置
   */
  removeProviderDefaults(providerName: string): void {
    this.providerDefaults.delete(providerName);
  }

  /**
   * 清除所有提供者特有配置
   */
  clearProviderDefaults(): void {
    this.providerDefaults.clear();
  }

  /**
   * 解析三层配置，返回最终配置
   *
   * 优先级（从低到高）：
   *   global.defaultVoice < provider.voice < call.voice
   *   global.defaultSpeed < provider.speed < call.speed
   */
  resolve(
    callOptions: TTSSpeakOptions,
    providerName?: string
  ): ResolvedTTSConfig {
    const providerDefaults = providerName
      ? this.providerDefaults.get(providerName)
      : undefined;

    return {
      voice:
        callOptions.voice ??
        providerDefaults?.voice ??
        (this.globalConfig.defaultVoice || undefined),
      speed:
        callOptions.speed ??
        providerDefaults?.speed ??
        this.globalConfig.defaultSpeed,
      language:
        callOptions.language ??
        providerDefaults?.language ??
        this.globalConfig.defaultLanguage,
      textPreprocessing: this.globalConfig.textPreprocessing,
    };
  }

  /**
   * 将解析后的配置合并到 TTSSpeakOptions 中
   */
  resolveSpeakOptions(
    callOptions: TTSSpeakOptions,
    providerName?: string
  ): TTSSpeakOptions {
    const resolved = this.resolve(callOptions, providerName);

    return {
      text: callOptions.text,
      voice: resolved.voice,
      speed: resolved.speed,
      language: resolved.language,
    };
  }
}

/** 全局单例 */
let defaultOverlay: TTSConfigOverlay | null = null;

/**
 * 获取或创建全局默认配置覆盖
 */
export function getDefaultConfigOverlay(): TTSConfigOverlay {
  if (!defaultOverlay) {
    defaultOverlay = new TTSConfigOverlay();
  }
  return defaultOverlay;
}

/**
 * 重置全局默认配置覆盖（主要用于测试）
 */
export function resetDefaultConfigOverlay(): void {
  defaultOverlay = null;
}
