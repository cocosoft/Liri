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
 * 压缩服务类型定义
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface CompactionResult {
  boundaryMarker: string;
  summaryMessages: string[];
  attachments: string[];
  hookResults: string[];
  messagesToKeep?: string[];
  userDisplayMessage?: string;
  preCompactTokenCount?: number;
  postCompactTokenCount?: number;
  truePostCompactTokenCount?: number;
  compactionUsage?: TokenUsage;
}

export interface CompactThreshold {
  autoCompactThreshold: number;
  warningThreshold: number;
  errorThreshold: number;
  blockingLimit: number;
}

export interface CompactState {
  compacted: boolean;
  turnCounter: number;
  turnId: string;
  consecutiveFailures: number;
}

export interface AutoCompactOptions {
  model: string;
  effectiveContextWindow: number;
  autoCompactThreshold?: number;
  warningThresholdBuffer?: number;
  errorThresholdBuffer?: number;
  manualCompactBuffer?: number;
}

export interface TokenWarningState {
  percentLeft: number;
  isAboveWarningThreshold: boolean;
  isAboveErrorThreshold: boolean;
  isAboveAutoCompactThreshold: boolean;
  isAtBlockingLimit: boolean;
}

export type { CompactConversationOptions } from './CompactService';
