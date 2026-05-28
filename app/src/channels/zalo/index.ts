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
 * channels/zalo/index.ts - Zalo 通道导出
 */

export {
  ZaloChannel,
  zaloChannel,
  createZaloChannel,
  zaloChannelPlugin,
} from './ZaloChannel.js';
export type { ZaloConfig, ZaloMessage } from './ZaloChannel.js';

export { getDefaultZaloConfig, validateZaloConfig } from './config-schema.js';
export type { ZaloConfig as ZaloChannelConfig } from './config-schema.js';

export {
  registerZaloAccount,
  getZaloAccount,
  resolveZaloAccount,
  listZaloAccountIds,
  removeZaloAccount,
} from './accounts.js';
export type { ZaloAccount, ResolvedZaloAccount } from './accounts.js';

export { ZaloMonitor } from './monitor.js';
export type {
  MonitorEvent as ZaloMonitorEvent,
  MonitorStats as ZaloMonitorStats,
} from './monitor.js';

export { diagnoseZalo } from './doctor.js';
export type {
  DiagnosisResult as ZaloDiagnosisResult,
  ZaloDiagnosisContext,
} from './doctor.js';

export { zaloProbe } from './probe.js';
export type { ProbeResult as ZaloProbeResult } from './probe.js';

export { setZaloRuntime, getZaloRuntime, clearZaloRuntime } from './runtime.js';
export type { ZaloRuntime, ZaloRuntimeStatus } from './runtime.js';
