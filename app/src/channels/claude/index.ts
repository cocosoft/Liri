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
 * channels/claude/index.ts - Claude 通道导出
 */

export {
  ClaudeChannel,
  claudeChannel,
  createClaudeChannel,
  claudeChannelPlugin,
} from './ClaudeChannel.js';
export type { ClaudeConfig, ClaudeMessage } from './ClaudeChannel.js';

export {
  getDefaultClaudeConfig,
  validateClaudeConfig,
} from './config-schema.js';
export type { ClaudeConfig as ClaudeChannelConfig } from './config-schema.js';

export {
  registerClaudeAccount,
  getClaudeAccount,
  resolveClaudeAccount,
  listClaudeAccountIds,
  removeClaudeAccount,
} from './accounts.js';
export type { ClaudeAccount, ResolvedClaudeAccount } from './accounts.js';

export { ClaudeMonitor } from './monitor.js';
export type {
  MonitorEvent as ClaudeMonitorEvent,
  MonitorStats as ClaudeMonitorStats,
} from './monitor.js';

export { diagnoseClaude } from './doctor.js';
export type {
  DiagnosisResult as ClaudeDiagnosisResult,
  ClaudeDiagnosisContext,
} from './doctor.js';

export { claudeProbe } from './probe.js';
export type { ProbeResult as ClaudeProbeResult } from './probe.js';

export {
  setClaudeRuntime,
  getClaudeRuntime,
  clearClaudeRuntime,
} from './runtime.js';
export type { ClaudeRuntime, ClaudeRuntimeStatus } from './runtime.js';
