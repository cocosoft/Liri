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
 * channels/yuanbao/index.ts - 元宝通道导出
 */

export {
  YuanbaoChannel,
  yuanbaoChannel,
  createYuanbaoChannel,
  yuanbaoChannelPlugin,
} from './YuanbaoChannel.js';
export type { YuanbaoConfig, YuanbaoMessage } from './YuanbaoChannel.js';

export {
  getDefaultYuanbaoConfig,
  validateYuanbaoConfig,
} from './config-schema.js';
export type { YuanbaoConfig as YuanbaoChannelConfig } from './config-schema.js';

export {
  registerYuanbaoAccount,
  getYuanbaoAccount,
  resolveYuanbaoAccount,
  listYuanbaoAccountIds,
  removeYuanbaoAccount,
} from './accounts.js';
export type { YuanbaoAccount, ResolvedYuanbaoAccount } from './accounts.js';

export { YuanbaoMonitor } from './monitor.js';
export type {
  MonitorEvent as YuanbaoMonitorEvent,
  MonitorStats as YuanbaoMonitorStats,
} from './monitor.js';

export { diagnoseYuanbao } from './doctor.js';
export type {
  DiagnosisResult as YuanbaoDiagnosisResult,
  YuanbaoDiagnosisContext,
} from './doctor.js';

export { yuanbaoProbe } from './probe.js';
export type { ProbeResult as YuanbaoProbeResult } from './probe.js';

export {
  setYuanbaoRuntime,
  getYuanbaoRuntime,
  clearYuanbaoRuntime,
} from './runtime.js';
export type { YuanbaoRuntime, YuanbaoRuntimeStatus } from './runtime.js';
