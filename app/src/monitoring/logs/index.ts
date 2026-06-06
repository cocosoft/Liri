/**
 * 日志系统统一导出
 * 收敛所有日志子模块的 barrel export
 */

export {
  Logger,
  LogLevel,
  getLogger,
  createLogger,
  setGlobalConfigProvider,
} from './Logger.js';
export type { LoggerConfig } from './Logger.js';

export { StructuredLogger } from './StructuredLogger.js';
export type { StructuredLogEntry } from './LogMemory.js';
export { MODULE_LOG_MEMORY, appendLogEntry, clearLogMemory, getLogMemoryCount } from './LogMemory.js';

export { logConfigManager, LogConfigManager } from './config/LogConfig.js';
export type { LogTarget, LogConfiguration } from './config/LogConfig.js';

export { logRedact, LogRedact } from './redact/LogRedact.js';
export type { RedactPattern, LogRedactConfig } from './redact/LogRedact.js';

export { logFilter, LogFilter } from './filter/LogFilter.js';
export type { FilterRule, LogFilterConfig } from './filter/LogFilter.js';

export { logDiagnostic, LogDiagnostic } from './diagnostic/LogDiagnostic.js';
export type {
  DiagnosticConfig,
  DiagnosticCheck,
  DiagnosticResult,
} from './diagnostic/LogDiagnostic.js';

export { LogTail } from './tail/LogTail.js';
export type { TailOptions, LogLine } from './tail/LogTail.js';
