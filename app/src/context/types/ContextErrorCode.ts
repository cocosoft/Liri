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
 * 上下文模块专用错误码
 * Phase 2: 替代所有 '1000' 统一错误码
 */
export const ContextErrorCode = {
  /** 上下文未找到 */
  CONTEXT_NOT_FOUND: 'CTX-2001',
  /** 上下文已过期 */
  CONTEXT_EXPIRED: 'CTX-2002',
  /** 上下文注入失败 */
  INJECTION_FAILED: 'CTX-2003',
  /** 上下文隔离违规 */
  ISOLATION_VIOLATED: 'CTX-2004',
  /** 上下文压缩失败 */
  COMPRESSION_FAILED: 'CTX-2005',
  /** 生命周期状态非法 */
  LIFECYCLE_INVALID: 'CTX-2006',
  /** 存储已满 */
  STORE_FULL: 'CTX-2007',
  /** 上下文窗口超限 */
  WINDOW_EXCEEDED: 'CTX-2008',
  /** 恢复尝试已耗尽 */
  RECOVERY_EXHAUSTED: 'CTX-2009',
} as const;

export type ContextErrorCodeType =
  (typeof ContextErrorCode)[keyof typeof ContextErrorCode];
