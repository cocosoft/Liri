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
 * channels/whatsapp/index.ts - WhatsApp 通道导出
 */

export {
  WhatsAppChannel,
  whatsAppChannel,
  createWhatsAppChannel,
  whatsAppChannelPlugin,
} from './WhatsAppChannel.js';
export type { WhatsAppConfig, WhatsAppMessage } from './WhatsAppChannel.js';

export {
  getDefaultWhatsAppConfig,
  validateWhatsAppConfig,
} from './config-schema.js';
export type { WhatsAppConfig as WhatsAppChannelConfig } from './config-schema.js';

export {
  registerWhatsAppAccount,
  getWhatsAppAccount,
  resolveWhatsAppAccount,
  listWhatsAppAccountIds,
  removeWhatsAppAccount,
} from './accounts.js';
export type { WhatsAppAccount, ResolvedWhatsAppAccount } from './accounts.js';

export { WhatsAppMonitor } from './monitor.js';
export type {
  MonitorEvent as WhatsAppMonitorEvent,
  MonitorStats as WhatsAppMonitorStats,
} from './monitor.js';

export { diagnoseWhatsApp } from './doctor.js';
export type {
  DiagnosisResult as WhatsAppDiagnosisResult,
  WhatsAppDiagnosisContext,
} from './doctor.js';

export { whatsappProbe } from './probe.js';
export type { ProbeResult as WhatsAppProbeResult } from './probe.js';

export {
  setWhatsAppRuntime,
  getWhatsAppRuntime,
  clearWhatsAppRuntime,
} from './runtime.js';
export type { WhatsAppRuntime, WhatsAppRuntimeStatus } from './runtime.js';
