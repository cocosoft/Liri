/**
 * channels/telegram/index.ts - Telegram 通道导出
 */

export {
  telegramChannel,
  createTelegramChannel,
  telegramChannelPlugin,
  escapeMarkdownV2,
  buildInlineKeyboard,
} from './TelegramChannel.js';

export { getDefaultTelegramConfig, validateTelegramConfig } from './config-schema.js';
export type { TelegramConfig } from './config-schema.js';

export {
  registerTelegramAccount,
  getTelegramAccount,
  resolveTelegramAccount,
  listTelegramAccountIds,
  removeTelegramAccount,
} from './accounts.js';
export type { TelegramAccount, ResolvedTelegramAccount } from './accounts.js';

export { TelegramMonitor } from './monitor.js';
export type {
  MonitorEvent as TelegramMonitorEvent,
  MonitorStats as TelegramMonitorStats,
} from './monitor.js';

export { diagnoseTelegram } from './doctor.js';
export type {
  DiagnosisResult as TelegramDiagnosisResult,
  TelegramDiagnosisContext,
} from './doctor.js';

export { telegramProbe } from './probe.js';
export type { ProbeResult as TelegramProbeResult } from './probe.js';

export {
  setTelegramRuntime,
  getTelegramRuntime,
  clearTelegramRuntime,
} from './runtime.js';
export type { TelegramRuntime, TelegramRuntimeStatus } from './runtime.js';
