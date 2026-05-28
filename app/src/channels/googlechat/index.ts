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
  createGoogleChatChannel,
  googleChatChannelPlugin,
} from './GoogleChatChannel.js';
export {
  getDefaultGoogleChatConfig,
  validateGoogleChatConfig,
} from './config-schema.js';
export type { GoogleChatConfig } from './config-schema.js';
export {
  registerGoogleChatAccount,
  getGoogleChatAccount,
  resolveGoogleChatAccount,
  listGoogleChatAccountIds,
  removeGoogleChatAccount,
} from './accounts.js';
export type {
  GoogleChatAccount,
  ResolvedGoogleChatAccount,
} from './accounts.js';
export { GoogleChatMonitor } from './monitor.js';
export type {
  MonitorEvent as GoogleChatMonitorEvent,
  MonitorStats as GoogleChatMonitorStats,
} from './monitor.js';
export { diagnoseGoogleChat } from './doctor.js';
export type {
  DiagnosisResult as GoogleChatDiagnosisResult,
  GoogleChatDiagnosisContext,
} from './doctor.js';
export { googleChatProbe } from './probe.js';
export type { ProbeResult as GoogleChatProbeResult } from './probe.js';
export {
  normalizeGoogleChatApproverId,
  resolveGoogleChatApprovers,
  isGoogleChatSenderAuthorized,
} from './approval-auth.js';
export type {
  GoogleChatApproverInfo,
  GoogleChatApprovalAuthConfig,
  GoogleChatApprovalAuthResult,
} from './approval-auth.js';
export {
  setGoogleChatRuntime,
  getGoogleChatRuntime,
  clearGoogleChatRuntime,
} from './runtime.js';
export type { GoogleChatRuntime, GoogleChatRuntimeStatus } from './runtime.js';
