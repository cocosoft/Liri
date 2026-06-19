/**
 * core/spi/ — SPI 接口统一出口
 *
 * SPI（Service Provider Interface）是 core 层定义的抽象契约，
 * 由上层（infra/app/service）实现后通过 DI 容器注入。
 *
 * 使用 SPI 的核心原则：
 * 1. core 层只定义接口，不引用任何上层实现
 * 2. 上层实现注册到 DI 容器，core 层通过容器获取
 * 3. 所有 SPI 接口集中在 core/spi/ 目录中统一管理
 */

export {
  type ILogger,
  type ILoggerService,
  LogLevel as SpiLogLevel,
  LOGGER_SERVICE_ID,
  registerLoggerSpi,
  resolveLogger,
} from './LoggerService';

export {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  ERROR_SERVICE_ID,
} from './ErrorTypes';

export { TtlCache } from './CacheService';
