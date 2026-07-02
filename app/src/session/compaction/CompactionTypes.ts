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

import type { Session } from '../models/Session';

/**
 * 压缩引擎接口 — 各压缩策略实现此接口
 * 由 SessionCompactionBridge 管理和调度
 */
export interface CompactionEngine {
  checkAndCompact(
    sessionId: string,
    messages: Session['messages'],
    model: string
  ): { shouldCompact: boolean };
  performAutoCompact(
    sessionId: string,
    messages: Session['messages'],
    model: string
  ): Promise<{ success: boolean; error?: string }>;
}

/**
 * AutoCompactService 引用接口 — 避免直接依赖 services/compact 模块
 */
export interface AutoCompactServiceRef {
  checkAndCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): { shouldCompact: boolean };
  performAutoCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): Promise<{ success: boolean; error?: string }>;
}
