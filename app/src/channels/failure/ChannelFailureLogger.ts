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
 * ChannelFailureLogger — 通道失败日志结构化写入
 *
 * 将通道消息发送/接收失败写入结构化日志文件，包含：
 * - AppError 核心字段（category, severity, errorCode, errorStack）
 * - 通道上下文（channelType, target, attemptedAction）
 * - 重试信息（retryCount, maxRetries）
 *
 * 文件位置：~/.pyapp/data/failure-logs/channel-failures.jsonl（JSONL 格式，每天轮转）
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ level: LogLevel.WARN, module: 'channels:failure' });

/** 失败日志记录 */
export interface ChannelFailureRecord {
  /** 消息 ID（关联消息上下文） */
  messageId?: string;
  /** 失败发生时间 */
  failedAt: number;
  /** 通道名称 */
  channelName: string;
  /** 通道类型 */
  channelType: string;
  /** 目标地址/会话 */
  target?: string;
  /** 尝试的操作 */
  attemptedAction: string;
  /** 错误码 */
  errorCode: string;
  /** 错误类别 */
  category: string;
  /** 严重级别 */
  severity: string;
  /** 错误描述 */
  error: string;
  /** 完整堆栈 */
  errorStack?: string;
  /** 当前重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 额外上下文 */
  context?: Record<string, unknown>;
}

/** 失败日志文件路径 */
function getFailureLogPath(): string {
  const dir = join(resolveDataDir(), 'failure-logs');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(dir, `channel-failures-${date}.jsonl`);
}

/**
 * 写入通道失败日志（JSONL 格式，追加写入）
 */
export function writeChannelFailureLog(record: ChannelFailureRecord): void {
  const logPath = getFailureLogPath();
  const line = JSON.stringify(record) + '\n';

  try {
    appendFileSync(logPath, line, 'utf-8');
  } catch (error) {
    handleError(error instanceof Error ? error : new Error(String(error)), {
      module: 'channels:failure',
      action: '失败日志写入失败',
    });
  }
}

/**
 * 从 AppError 构建失败日志记录
 */
export function buildFailureRecord(
  error: Error & {
    code?: string;
    category?: string;
    severity?: string;
    stack?: string;
  },
  channelInfo: {
    messageId?: string;
    channelName: string;
    channelType: string;
    target?: string;
    attemptedAction: string;
    retryCount: number;
    maxRetries: number;
  }
): ChannelFailureRecord {
  return {
    messageId: channelInfo.messageId,
    failedAt: Date.now(),
    channelName: channelInfo.channelName,
    channelType: channelInfo.channelType,
    target: channelInfo.target,
    attemptedAction: channelInfo.attemptedAction,
    errorCode: error.code || 'UNKNOWN',
    category: error.category || 'unknown',
    severity: error.severity || 'medium',
    error: error.message,
    errorStack: error.stack,
    retryCount: channelInfo.retryCount,
    maxRetries: channelInfo.maxRetries,
  };
}
