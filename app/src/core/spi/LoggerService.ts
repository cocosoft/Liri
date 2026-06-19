/**
 * Logger SPI 接口
 *
 * 定义 core 层的日志抽象接口，不依赖任何 infra 或 monitoring 层的实现。
 * 具体实现在 monitoring/logs/Logger.ts 中通过 DIContainer 注册。
 *
 * 使用方式：
 *   const logger = resolveLogger('moduleName');
 *   logger.info('message');
 */

/**
 * 日志级别枚举（与 monitoring 层 LogLevel 保持一致）
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  WARNING = 'warning',
  ERROR = 'error',
  FATAL = 'fatal',
}

/**
 * Logger 核心接口
 *
 * 仅声明 core 层需要的日志方法，不包含对 infra 层 Logger 实现的引用。
 */
export interface ILogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  warning(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  error(message: string, error: Error): void;
  fatal(message: string, meta?: unknown): void;
}

/**
 * Logger SPI 服务接口
 *
 * 由 DI 容器注册具体实现，core 层代码通过此接口获取 Logger 实例。
 */
export interface ILoggerService {
  /**
   * 获取或创建指定模块的 Logger 实例
   * @param module - 模块名，用于按模块区分日志来源
   */
  getLogger(module?: string): ILogger;

  /**
   * 设置全局默认配置提供者
   * @param provider - 配置提供函数
   */
  setGlobalConfigProvider(provider: () => Record<string, unknown>): void;
}

/** SPI 服务标识符常量 */
export const LOGGER_SERVICE_ID = 'core.spi.ILoggerService';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerLoggerSpi 在启动时设置
// core 层代码通过 resolveLogger() 获取 Logger，避免直接 import monitoring 层
// ---------------------------------------------------------------------------

let _loggerService: ILoggerService | null = null;

/** 空操作 Logger：在 SPI 服务注册完成前提供安全降级 */
function createNoopLogger(): ILogger {
  return {
    debug() {
      /* noop */
    },
    info() {
      /* noop */
    },
    warn() {
      /* noop */
    },
    warning() {
      /* noop */
    },
    error() {
      /* noop */
    },
    fatal() {
      /* noop */
    },
  };
}

/**
 * 获取 core 层 Logger 实例
 *
 * 在 registerLoggerSpi() 完成后返回 monitoring 层实际 Logger；
 * 在此之前返回 noop Logger，保证启动阶段不会因空指针崩溃。
 *
 * @param module - 模块名称（可选）
 */
export function resolveLogger(module?: string): ILogger {
  if (!_loggerService) {
    return createNoopLogger();
  }
  return _loggerService.getLogger(module);
}

/**
 * 注册 Logger SPI 实现到 DI 容器
 *
 * 动态导入 monitoring 层的 Logger 实现并注册为 SPI 服务。
 * 此函数不产生静态跨层依赖，符合架构分层约束。
 *
 * @param container - DI 容器实例
 */
export async function registerLoggerSpi(container: {
  registerDescriptor: <T>(desc: {
    id: string;
    factory: () => T;
    scope: 'singleton' | 'transient' | 'request';
  }) => void;
}): Promise<void> {
  const {
    getLogger: getLoggerImpl,
    setGlobalConfigProvider: setGlobalConfigProviderImpl,
  } = await import('../../monitoring/logs/Logger');

  const service: ILoggerService = {
    getLogger(module?: string): ILogger {
      return getLoggerImpl(module);
    },
    setGlobalConfigProvider(provider: () => Record<string, unknown>): void {
      setGlobalConfigProviderImpl(provider);
    },
  };

  // 设置内部引用，使 resolveLogger() 可正常工作
  _loggerService = service;

  container.registerDescriptor<ILoggerService>({
    id: LOGGER_SERVICE_ID,
    factory: () => service,
    scope: 'singleton',
  });
}
