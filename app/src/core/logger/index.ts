/**
 * core/logger/ — 日志模块统一入口
 *
 * 优先使用 SPI 接口从 DI 容器解析 Logger 实现，
 * 回退路径保持向后兼容（过渡期）。
 *
 * @deprecated 直接使用 core/spi/LoggerService 中的 ILogger + ILoggerService 接口。
 *             新代码应通过 getDIContainer().resolve<ILoggerService>(LOGGER_SERVICE_ID)
 *             获取 Logger 实例。
 */

import { type ILogger, type ILoggerService, LOGGER_SERVICE_ID } from '../spi/LoggerService';
import { getDIContainer } from '../di/DIContainer';

/** 按模块名缓存的回退 Logger 实例 */
const _fallbackLoggers = new Map<string, ILogger>();

/** 极早期默认 Logger（DI 容器和 monitoring 层均未就绪时使用） */
function _createNoopLogger(module: string): ILogger {
  return {
    debug: (message: string, meta?: unknown) =>
      console.debug(`[${module}] ${message}`, meta ?? ''),
    info: (message: string, meta?: unknown) =>
      console.info(`[${module}] ${message}`, meta ?? ''),
    warn: (message: string, meta?: unknown) =>
      console.warn(`[${module}] ${message}`, meta ?? ''),
    warning: (message: string, meta?: unknown) =>
      console.warn(`[${module}] ${message}`, meta ?? ''),
    error(message: string, meta?: unknown): void;
    error(message: string, error: Error): void;
    error(message: string, metaOrError?: unknown): void {
      console.error(
        `[${module}] ${message}`,
        metaOrError instanceof Error ? metaOrError : (metaOrError ?? '')
      );
    },
    fatal: (message: string, meta?: unknown) =>
      console.error(`[${module}] FATAL: ${message}`, meta ?? ''),
  };
}

/**
 * 获取模块名对应的日志实例（SPI 感知）
 *
 * 优先从 DI 容器解析 ILoggerService，
 * 若容器未初始化则回退到缓存实例或默认控制台日志。
 */
export function getLogger(module?: string): ILogger {
  // 优先从 DI 容器解析 SPI 实现
  const container = getDIContainer();
  if (container.hasDescriptor(LOGGER_SERVICE_ID)) {
    const service = container.resolve<ILoggerService>(LOGGER_SERVICE_ID);
    return service.getLogger(module);
  }

  // 回退路径：使用缓存的监测层 Logger 实例
  const key = module ?? 'app';
  const cached = _fallbackLoggers.get(key);
  if (cached) return cached;

  // 极早期回退：模块尚未初始化，返回默认 noop logger
  const noop = _createNoopLogger(key);
  _fallbackLoggers.set(key, noop);
  return noop;
}

// 保持类型导出兼容
export type { ILogger } from '../spi/LoggerService';
