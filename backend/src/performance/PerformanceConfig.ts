//
/**
 * 性能优化配置管理
 * 用于管理性能优化系统的配置参数
 */

import { isEnvTruthy } from '../utils/envUtils.js';
import { logForDebugging } from '../utils/debug.js';

/**
 * 从环境变量获取数字值
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const envValue = process.env[key];
  if (envValue !== undefined) {
    const parsed = Number(envValue);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

/**
 * 性能优化配置
 */
export interface PerformanceConfig {
  // 启动性能分析配置
  startupProfiling: {
    /** 是否启用详细分析 */
    enabled: boolean;
    /** 采样率（0-1） */
    sampleRate: number;
  };

  // 慢操作检测配置
  slowOperations: {
    /** 慢操作阈值（毫秒） */
    thresholdMs: number;
    /** 是否启用慢操作检测 */
    enabled: boolean;
  };

  // 内存管理配置
  memoryManagement: {
    /** 是否启用内存优化 */
    enabled: boolean;
    /** 内存阈值（MB） */
    thresholdMb: number;
    /** 检查间隔（毫秒） */
    checkIntervalMs: number;
    /** 堆使用百分比阈值（%） */
    heapUsageThreshold: number;
    /** 内存增长率阈值（%） */
    growthRateThreshold: number;
    /** 自动垃圾回收阈值（%） */
    gcThreshold: number;
    /** 最大快照数量 */
    maxSnapshots: number;
  };

  // 缓存配置
  cache: {
    /** 缓存大小限制（MB） */
    sizeLimitMb: number;
    /** 缓存过期时间（毫秒） */
    expirationMs: number;
  };

  // 延迟加载配置
  lazyLoading: {
    /** 是否启用延迟加载 */
    enabled: boolean;
    /** 预加载阈值（毫秒） */
    preloadThresholdMs: number;
  };
}

/**
 * 默认性能优化配置
 */
const DEFAULT_CONFIG: PerformanceConfig = {
  startupProfiling: {
    enabled: isEnvTruthy(process.env.PY_APP_PROFILE_STARTUP),
    sampleRate: process.env.USER_TYPE === 'ant' ? 1.0 : 0.005,
  },
  slowOperations: {
    thresholdMs: getEnvNumber(
      'PY_APP_SLOW_OPERATION_THRESHOLD_MS',
      process.env.NODE_ENV === 'development' ? 20 : 300
    ),
    enabled: true,
  },
  memoryManagement: {
    enabled: true,
    thresholdMb: getEnvNumber('PY_APP_MEMORY_THRESHOLD_MB', 512),
    checkIntervalMs: getEnvNumber('PY_APP_MEMORY_CHECK_INTERVAL_MS', 60000),
    heapUsageThreshold: 85,
    growthRateThreshold: 20,
    gcThreshold: 90,
    maxSnapshots: 100,
  },
  cache: {
    sizeLimitMb: getEnvNumber('PY_APP_CACHE_SIZE_LIMIT_MB', 100),
    expirationMs: getEnvNumber('PY_APP_CACHE_EXPIRATION_MS', 3600000),
  },
  lazyLoading: {
    enabled: isEnvTruthy(process.env.PY_APP_LAZY_LOADING_ENABLED),
    preloadThresholdMs: getEnvNumber('PY_APP_PRELOAD_THRESHOLD_MS', 100),
  },
};

/**
 * 性能优化配置管理
 */
export class PerformanceConfigManager {
  private config: PerformanceConfig;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.validateConfig();
    logForDebugging('性能优化配置已初始化', this.config);
  }

  /**
   * 获取当前配置
   */
  getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
    this.notifyListeners();
    logForDebugging('性能优化配置已更新', this.config);
  }

  /**
   * 从环境变量重新加载配置
   */
  reloadFromEnvironment(): void {
    this.config = {
      startupProfiling: {
        enabled: isEnvTruthy(process.env.PY_APP_PROFILE_STARTUP),
        sampleRate: process.env.USER_TYPE === 'ant' ? 1.0 : 0.005,
      },
      slowOperations: {
        thresholdMs: getEnvNumber(
          'PY_APP_SLOW_OPERATION_THRESHOLD_MS',
          process.env.NODE_ENV === 'development' ? 20 : 300
        ),
        enabled: true,
      },
      memoryManagement: {
        enabled: true,
        thresholdMb: getEnvNumber('PY_APP_MEMORY_THRESHOLD_MB', 512),
        checkIntervalMs: getEnvNumber('PY_APP_MEMORY_CHECK_INTERVAL_MS', 60000),
        heapUsageThreshold: 85,
        growthRateThreshold: 20,
        gcThreshold: 90,
        maxSnapshots: 100,
      },
      cache: {
        sizeLimitMb: getEnvNumber('PY_APP_CACHE_SIZE_LIMIT_MB', 100),
        expirationMs: getEnvNumber('PY_APP_CACHE_EXPIRATION_MS', 3600000),
      },
      lazyLoading: {
        enabled: isEnvTruthy(process.env.PY_APP_LAZY_LOADING_ENABLED),
        preloadThresholdMs: getEnvNumber('PY_APP_PRELOAD_THRESHOLD_MS', 100),
      },
    };
    this.validateConfig();
    this.notifyListeners();
    logForDebugging('性能优化配置已从环境变量重新加载', this.config);
  }

  /**
   * 验证配置
   */
  private validateConfig(): void {
    // 验证启动性能分析配置
    if (
      this.config.startupProfiling.sampleRate < 0 ||
      this.config.startupProfiling.sampleRate > 1
    ) {
      logForDebugging('无效的启动性能分析采样率，使用默认值', {
        level: 'warn',
      });
      this.config.startupProfiling.sampleRate =
        DEFAULT_CONFIG.startupProfiling.sampleRate;
    }

    // 验证慢操作检测配置
    if (this.config.slowOperations.thresholdMs < 0) {
      logForDebugging('无效的慢操作阈值，使用默认值', { level: 'warn' });
      this.config.slowOperations.thresholdMs =
        DEFAULT_CONFIG.slowOperations.thresholdMs;
    }

    // 验证内存管理配置
    if (this.config.memoryManagement.thresholdMb < 0) {
      logForDebugging('无效的内存阈值，使用默认值', { level: 'warn' });
      this.config.memoryManagement.thresholdMb =
        DEFAULT_CONFIG.memoryManagement.thresholdMb;
    }
    if (this.config.memoryManagement.checkIntervalMs < 0) {
      logForDebugging('无效的内存检查间隔，使用默认值', { level: 'warn' });
      this.config.memoryManagement.checkIntervalMs =
        DEFAULT_CONFIG.memoryManagement.checkIntervalMs;
    }

    // 验证缓存配置
    if (this.config.cache.sizeLimitMb < 0) {
      logForDebugging('无效的缓存大小限制，使用默认值', { level: 'warn' });
      this.config.cache.sizeLimitMb = DEFAULT_CONFIG.cache.sizeLimitMb;
    }
    if (this.config.cache.expirationMs < 0) {
      logForDebugging('无效的缓存过期时间，使用默认值', { level: 'warn' });
      this.config.cache.expirationMs = DEFAULT_CONFIG.cache.expirationMs;
    }

    // 验证延迟加载配置
    if (this.config.lazyLoading.preloadThresholdMs < 0) {
      logForDebugging('无效的预加载阈值，使用默认值', { level: 'warn' });
      this.config.lazyLoading.preloadThresholdMs =
        DEFAULT_CONFIG.lazyLoading.preloadThresholdMs;
    }
  }

  /**
   * 注册配置变更监听器
   */
  onConfigChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除配置变更监听器
   */
  offConfigChange(listener: () => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知配置变更监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logForDebugging(
          `配置变更监听器执行失败: ${error instanceof Error ? error.message : String(error)}`,
          { level: 'error' }
        );
      }
    }
  }
}

/**
 * 全局性能配置管理器实例
 */
export const performanceConfigManager = new PerformanceConfigManager();

/**
 * 获取性能配置
 */
export function getPerformanceConfig(): PerformanceConfig {
  return performanceConfigManager.getConfig();
}

/**
 * 更新性能配置
 */
export function updatePerformanceConfig(
  updates: Partial<PerformanceConfig>
): void {
  performanceConfigManager.updateConfig(updates);
}

/**
 * 从环境变量重新加载性能配置
 */
export function reloadPerformanceConfig(): void {
  performanceConfigManager.reloadFromEnvironment();
}
