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
 * 知识库审计日志记录器
 *
 * 以 JSONL 格式记录所有写操作（创建/更新/删除），
 * 存储到 ~/.pyapp/data/knowledge-audit.log。
 */
import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { resolveDataSubDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('knowledge:auditLogger');

/** 审计日志条目 */
export interface AuditLogEntry {
  timestamp: number;
  action: 'create' | 'update' | 'delete';
  target: { title: string; filePath: string; domain?: string };
  sessionId?: string;
  toolCallId?: string;
  result: 'success' | 'failure';
  reason?: string;
}

/** 审计日志文件路径 */
const AUDIT_LOG_PATH = join(resolveDataSubDir(''), 'knowledge-audit.log');

/**
 * 写入一条审计日志（JSONL 追加）
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const dir = dirname(AUDIT_LOG_PATH);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const line = JSON.stringify(entry) + '\n';
    await appendFile(AUDIT_LOG_PATH, line, 'utf-8');
  } catch (error) {
    logger.warning('审计日志写入失败', {
      action: entry.action,
      error: String(error),
    });
  }
}
