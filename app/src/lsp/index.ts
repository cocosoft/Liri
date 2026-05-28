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
export * from './types.js';
export { createLSPClient } from './LSPClient.js';
export type { LSPClient } from './LSPClient.js';
export { createLSPServerInstance } from './LSPServerInstance.js';
export type { LSPServerInstance } from './LSPServerInstance.js';
export { createLSPServerManager } from './LSPServerManager.js';
export type { LSPServerManager } from './LSPServerManager.js';
export {
  registerPendingLSPDiagnostic,
  checkForLSPDiagnostics,
  clearLSPDiagnostics,
} from './LSPDiagnosticRegistry.js';
export type { PendingLSPDiagnostic } from './LSPDiagnosticRegistry.js';
export {
  formatDiagnosticsForAttachment,
  registerLSPNotificationHandlers,
} from './passiveFeedback.js';
export type { HandlerRegistrationResult } from './passiveFeedback.js';

// 导出增强功能
export * from './EnhancedLSPManager.js';
export * from './IntelligentLSPAnalyzer.js';

// 导出Zod Schema验证
export * from './schemas.js';
export {
  DiagnosticsContextAdapter,
  getDiagnosticsContextAdapter,
} from './DiagnosticsContextAdapter';
export type {
  AgentDiagnosticEntry,
  AgentDiagnosticLevel,
  DiagnosticsAdapterConfig,
} from './DiagnosticsContextAdapter';

// 导出多语言 Server 配置注册表
export {
  LSPServerConfigRegistry,
  getDefaultConfigRegistry,
  createConfigRegistry,
} from './LSPServerConfigRegistry.js';
export type { LanguageServerRegistration } from './LSPServerConfigRegistry.js';

// 导出诊断展示工具
export {
  LSPDiagnosticDisplay,
  getDefaultDiagnosticDisplay,
  createDiagnosticDisplay,
} from './LSPDiagnosticDisplay.js';
export type {
  DisplayDiagnostic,
  DiagnosticSummary,
  GroupedDiagnostics,
  DiagnosticFormat,
} from './LSPDiagnosticDisplay.js';
