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
 * channels/signal/index.ts - Signal 通道导出
 */

export {
  SignalChannel,
  signalChannel,
  createSignalChannel,
  signalChannelPlugin,
} from './SignalChannel.js';
export type { SignalConfig, SignalMessage } from './SignalChannel.js';

export {
  getDefaultSignalConfig,
  validateSignalConfig,
} from './config-schema.js';
export type { SignalConfig as SignalChannelConfig } from './config-schema.js';

export {
  registerSignalAccount,
  getSignalAccount,
  resolveSignalAccount,
  listSignalAccountIds,
  removeSignalAccount,
} from './accounts.js';
export type { SignalAccount, ResolvedSignalAccount } from './accounts.js';

export { SignalMonitor } from './monitor.js';
export type {
  MonitorEvent as SignalMonitorEvent,
  MonitorStats as SignalMonitorStats,
} from './monitor.js';

export { diagnoseSignal } from './doctor.js';
export type {
  DiagnosisResult as SignalDiagnosisResult,
  SignalDiagnosisContext,
} from './doctor.js';

export { signalProbe } from './probe.js';
export type { ProbeResult as SignalProbeResult } from './probe.js';

export {
  setSignalRuntime,
  getSignalRuntime,
  clearSignalRuntime,
} from './runtime.js';
export type { SignalRuntime, SignalRuntimeStatus } from './runtime.js';
