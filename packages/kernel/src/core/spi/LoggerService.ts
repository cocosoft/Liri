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
//
// 2026-09-30（台账 D-70 / spec `monitoring-logger-core-spi.md`）语义升级：
//   ① **延迟绑定**：resolveLogger() 返回**转发代理**，每次调用时才解析当前实现。
//      原因：core 侧消费方多在**模块顶层**取 logger（`const logger = getLogger('x')`，
//      模块求值即执行），而 SPI 注册在 `DIContainer.start()`；若此刻直接返回当时可得的
//      实例，注册前求值的模块会把 noop **永久**绑进顶层常量 ⇒ 该模块此后全部日志静默消失。
//   ② **注册前缓冲 + 回放**：注册前的调用入队（上限 500），注册后回放，日志零丢失。
// ---------------------------------------------------------------------------

let _loggerService: ILoggerService | null = null;

/** 延迟绑定代理缓存（按 module；避免反复分配并保持身份稳定） */
const _deferredLoggers = new Map<string, ILogger>();

/** 可转发的方法名（与 ILogger 一致） */
type LogMethod = 'debug' | 'info' | 'warn' | 'warning' | 'error' | 'fatal';

/** 注册前缓冲上限（超出即计数丢弃，避免启动期无界增长） */
const PENDING_LOG_LIMIT = 500;

/** 注册前缓冲队列 */
const _pendingLogs: Array<{
  module?: string;
  method: LogMethod;
  args: [string, unknown?];
}> = [];

/** 注册前因缓冲上限被丢弃的日志条数 */
let _droppedLogs = 0;

/** 把一次日志调用派发到目标 ILogger */
function dispatch(
  target: ILogger,
  method: LogMethod,
  args: [string, unknown?]
): void {
  if (method === 'debug') target.debug(args[0], args[1]);
  else if (method === 'info') target.info(args[0], args[1]);
  else if (method === 'warn') target.warn(args[0], args[1]);
  else if (method === 'warning') target.warning(args[0], args[1]);
  else if (method === 'error') target.error(args[0], args[1]);
  else target.fatal(args[0], args[1]);
}

/** 创建延迟绑定 Logger（见文件内 ① 说明） */
function createDeferredLogger(module?: string): ILogger {
  const forward = (method: LogMethod, args: [string, unknown?]): void => {
    if (_loggerService) {
      dispatch(_loggerService.getLogger(module), method, args);
      return;
    }
    if (_pendingLogs.length < PENDING_LOG_LIMIT) {
      _pendingLogs.push({ module, method, args });
    } else {
      _droppedLogs++;
    }
  };

  return {
    debug: (message: string, meta?: unknown) =>
      forward('debug', [message, meta]),
    info: (message: string, meta?: unknown) => forward('info', [message, meta]),
    warn: (message: string, meta?: unknown) => forward('warn', [message, meta]),
    warning: (message: string, meta?: unknown) =>
      forward('warning', [message, meta]),
    error: (message: string, meta?: unknown) =>
      forward('error', [message, meta]),
    fatal: (message: string, meta?: unknown) =>
      forward('fatal', [message, meta]),
  };
}

/**
 * 回放注册前缓冲的日志（由 registerLoggerSpi 在注册完成后调用）
 *
 * **如实说明局限**：回放日志的**时间戳为回放时刻**（由 Logger 自填），并非原始发生时刻；
 * 刻意不伪造时间字段，以免与既有 JSON schema 冲突。回放条数与丢弃条数会汇总成 1 行。
 */
function flushPendingLogs(): void {
  const service = _loggerService;
  if (!service) return;

  const pending = _pendingLogs.splice(0, _pendingLogs.length);
  const dropped = _droppedLogs;
  _droppedLogs = 0;
  if (pending.length === 0 && dropped === 0) return;

  for (const entry of pending) {
    dispatch(service.getLogger(entry.module), entry.method, entry.args);
  }

  service
    .getLogger('core:spi:logger')
    .info(
      `Logger SPI 注册完成，回放注册前缓冲日志 ${pending.length} 条` +
        (dropped > 0 ? `（另有 ${dropped} 条因缓冲上限被丢弃）` : '')
    );
}

/**
 * 获取 core 层 Logger 实例（**延迟绑定**）
 *
 * 返回**转发代理**：注册完成后每次调用都走 monitoring 层实际实现；
 * 注册前调用进入缓冲队列，注册后自动回放（见文件内 ①② 说明）。
 *
 * @param module - 模块名称（可选）
 */
export function resolveLogger(module?: string): ILogger {
  const key = module ?? '';
  let cached = _deferredLoggers.get(key);
  if (!cached) {
    cached = createDeferredLogger(module);
    _deferredLoggers.set(key, cached);
  }
  return cached;
}

/**
 * 注册 Logger SPI 实现到 DI 容器
 *
 * 动态导入 monitoring 层的 Logger 实现并注册为 SPI 服务。
 * 此函数不产生静态跨层依赖，符合架构分层约束。
 *
 * @param container - DI 容器实例
 */
export async function registerLoggerSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: ILoggerService
): Promise<void> {
  // 2026-09-30（台账 D-129，`R00-003` ② 改造）：实现体改由 **entry** 侧装配模块构建后传入
  // （原实现在本文件内动态导入 `monitoring/logs/Logger` ⇒ `core -> infra` 跨层对）
  // 设置内部引用，使 resolveLogger() 可正常工作
  _loggerService = service;

  container.registerDescriptor<ILoggerService>({
    id: LOGGER_SERVICE_ID,
    factory: () => service,
    scope: 'singleton',
  });

  // 2026-09-30 D-70：回放注册前缓冲的日志（延迟绑定代理在注册前的调用已入队）
  flushPendingLogs();
}
