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
 * channels/sms/index.ts - SMS 通道导出
 */

export {
  SmsChannel,
  smsChannel,
  createSmsChannel,
  smsChannelPlugin,
} from './SmsChannel.js';
export type { SmsConfig, SmsMessage } from './SmsChannel.js';

export { getDefaultSmsConfig, validateSmsConfig } from './config-schema.js';
export type { SmsConfig as SmsChannelConfig } from './config-schema.js';

export {
  registerSmsAccount,
  getSmsAccount,
  resolveSmsAccount,
  listSmsAccountIds,
  removeSmsAccount,
} from './accounts.js';
export type { SmsAccount, ResolvedSmsAccount } from './accounts.js';

export { SmsMonitor } from './monitor.js';
export type {
  MonitorEvent as SmsMonitorEvent,
  MonitorStats as SmsMonitorStats,
} from './monitor.js';

export { diagnoseSms } from './doctor.js';
export type {
  DiagnosisResult as SmsDiagnosisResult,
  SmsDiagnosisContext,
} from './doctor.js';

export { smsProbe } from './probe.js';
export type { ProbeResult as SmsProbeResult } from './probe.js';

export { setSmsRuntime, getSmsRuntime, clearSmsRuntime } from './runtime.js';
export type { SmsRuntime, SmsRuntimeStatus } from './runtime.js';
