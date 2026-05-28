// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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

export {
  getDefaultTelegramConfig,
  validateTelegramConfig,
} from './config-schema.js';
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
