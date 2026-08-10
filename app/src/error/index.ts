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
 * 错误处理模块索引
 * 统一导出所有错误处理相关功能
 */

// 错误类型
export * from './types';

// 标准错误码
export { ErrorCodes } from './ErrorCodes';
export type { ErrorCodeKey, ErrorCodeValue } from './ErrorCodes';

// 错误 ID 追踪系统
export * from './ErrorIds';

// API 错误处理子模块
export * from './api';

// 错误工具函数
export * from './utils';

// 错误格式化器
export * from './formatter';

// 安全日志
export * from './safeLog';

// 错误分类器
export {
  ErrorClassifier,
  getErrorClassifier,
  classifyError,
  FailoverReason,
} from './ErrorClassifier';
export type { ErrorClassification } from './ErrorClassifier';

// 重试策略（标准实现在 query/withRetry.ts，已删除旧实现）

// 网络错误处理子模块
export {
  analyzeConnectionError,
  formatConnectionError,
  SSL_ERROR_CODES,
  getSSLErrorHint,
  getSSLUserMessage,
} from './network/ConnectionErrorAnalyzer';
export type {
  ConnectionErrorType,
  ConnectionAnalysis,
} from './network/ConnectionErrorAnalyzer';
export {
  SSLErrorType,
  analyzeSSLError,
  isSSLError,
  formatSSLError,
} from './network/SSLErrorHandler';
export type { SSLAnalysisResult } from './network/SSLErrorHandler';

// 错误上下文子模块
export * from './context';

// 统一错误处理入口
export { handleError } from './handleError';
export type { HandleErrorOptions } from './handleError';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('error:system');

// 高级错误分析（预留）

/**
 * 初始化错误处理系统
 */
export function initializeErrorSystem(): void {
  logger.info('[ErrorSystem] 错误处理系统初始化完成');
}

/**
 * 关闭错误处理系统
 */
export function shutdownErrorSystem(): void {
  logger.info('[ErrorSystem] 错误处理系统已关闭');
}
