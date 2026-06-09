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
export {
  feishuChannel,
  createFeishuChannel,
  feishuChannelPlugin,
} from './FeishuChannel';
export { getDefaultFeishuConfig, validateFeishuConfig } from './config-schema';
export type { FeishuConfig } from './config-schema';
export {
  registerFeishuAccount,
  getFeishuAccount,
  resolveFeishuAccount,
  listFeishuAccountIds,
  removeFeishuAccount,
} from './accounts';
export type { FeishuAccount, ResolvedFeishuAccount } from './accounts';
export { FeishuMonitor } from './monitor';
export type {
  MonitorEvent as FeishuMonitorEvent,
  MonitorStats as FeishuMonitorStats,
} from './monitor';
export { diagnoseFeishu } from './doctor';
export type {
  DiagnosisResult as FeishuDiagnosisResult,
  DiagnosisContext as FeishuDiagnosisContext,
} from './doctor';
export { feishuProbe } from './probe';
export type { ProbeResult as FeishuProbeResult } from './probe';
/**
 * 消息去重（已迁移至共享模块）
 * @deprecated 请直接使用 @modules/channels/dedup 的 claimMessage/finalizeMessage
 */
export { claimMessage, finalizeMessage } from './dedup';
export {
  normalizeFeishuApproverId,
  resolveFeishuApprovers,
  isFeishuSenderAuthorized,
} from './approval-auth';
export type {
  FeishuApproverInfo,
  FeishuApprovalAuthConfig,
  FeishuApprovalAuthResult,
} from './approval-auth';
export { FeishuStreamingCard } from './streaming-card';
export type { FeishuStreamState, FeishuStreamOptions } from './streaming-card';
export {
  setFeishuRuntime,
  getFeishuRuntime,
  clearFeishuRuntime,
} from './runtime';
export type { FeishuRuntime, FeishuRuntimeStatus } from './runtime';
