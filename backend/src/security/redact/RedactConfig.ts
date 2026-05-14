/**
 * 脱敏配置管理
 * 管理脱敏运行时配置，支持环境变量控制
 */
import {
  createRuntimeRedactEngine,
  RuntimeRedactEngine,
} from './RuntimeRedactEngine';

/**
 * 脱敏模式
 */
export type RedactMode = 'enabled' | 'disabled' | 'dry_run';

/**
 * 脱敏配置接口
 */
export interface RedactConfig {
  mode: RedactMode;
  enableShortTokenRedact: boolean;
  enableLongTokenRedact: boolean;
  enableEmailRedact: boolean;
  enableNumericRedact: boolean;
  enableObjectRecursion: boolean;
  maxRecursionDepth: number;
  extraPatterns: RegExp[];
}

/**
 * 默认脱敏配置
 */
export const DEFAULT_REDACT_CONFIG: RedactConfig = {
  mode: 'enabled',
  enableShortTokenRedact: true,
  enableLongTokenRedact: true,
  enableEmailRedact: true,
  enableNumericRedact: true,
  enableObjectRecursion: true,
  maxRecursionDepth: 10,
  extraPatterns: [],
};

/**
 * 从环境变量加载脱敏配置
 * @returns 脱敏配置
 */
export function loadRedactConfigFromEnv(): RedactConfig {
  const redactEnv = process.env['REDACT_ENABLED'];

  let mode: RedactMode = 'enabled';

  if (redactEnv === 'false' || redactEnv === '0' || redactEnv === 'no') {
    mode = 'disabled';
  } else if (
    redactEnv === 'dry_run' ||
    redactEnv === 'dry' ||
    redactEnv === 'audit'
  ) {
    mode = 'dry_run';
  }

  return {
    ...DEFAULT_REDACT_CONFIG,
    mode,
  };
}

/**
 * 全局脱敏引擎单例管理器
 */
export class RedactConfigManager {
  private static instance: RuntimeRedactEngine | null = null;

  /**
   * 获取脱敏引擎实例
   * @returns 脱敏引擎实例
   */
  static getEngine(): RuntimeRedactEngine {
    if (!RedactConfigManager.instance) {
      const config = loadRedactConfigFromEnv();
      const enabled = config.mode !== 'disabled';

      RedactConfigManager.instance = createRuntimeRedactEngine(
        enabled,
        config.extraPatterns
      );
    }

    return RedactConfigManager.instance;
  }

  /**
   * 重置脱敏引擎实例（用于测试或配置变更后）
   */
  static resetEngine(): void {
    RedactConfigManager.instance = null;
  }

  /**
   * 获取当前脱敏模式
   */
  static getMode(): RedactMode {
    return loadRedactConfigFromEnv().mode;
  }

  /**
   * 是否启用脱敏
   */
  static isEnabled(): boolean {
    const config = loadRedactConfigFromEnv();

    return config.mode !== 'disabled';
  }

  /**
   * 是否为 Dry Run 模式（仅记录脱敏匹配，不实际修改）
   */
  static isDryRun(): boolean {
    const config = loadRedactConfigFromEnv();

    return config.mode === 'dry_run';
  }
}
