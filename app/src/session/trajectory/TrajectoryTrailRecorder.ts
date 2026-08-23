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
 * TrajectoryTrailRecorder — PDCA 旁路轨迹文件（方案 T-G 建议 B，E-4）
 *
 * 目标：子步骤完整轨迹落旁路文件供轨迹面板回放（会话内回写保持 slice 节流，
 * 完整轨迹不占会话体积/上下文）。
 *
 * 存储：`~/.pyapp/data/trajectories/<sessionId>.jsonl`（会话外诊断数据，
 * 不参与会话事件存储/读写路径——CS01 不违反，CS03 说明见方案 T-G）。
 *
 * 生命周期：
 *   - 体积上限 5MB/会话，超限轮转（保留最近 KEEP_LINES 行）
 *   - 会话删除时调 cleanup(sessionId) 清理
 */

import { promises as fs, existsSync } from 'fs';
import { join, dirname } from 'path';
import { resolveDataDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring/logs/Logger.js';

const logger = getLogger('session:trajectory-trail');

/** 体积上限：5MB/会话（方案 T-G 评审 v0.1#10） */
const MAX_BYTES = 5 * 1024 * 1024;
/** 轮转保留行数（超限时截断保留最近 N 行） */
const KEEP_LINES = 2000;

/** 旁路轨迹条目 */
export interface TrajectoryTrailEntry {
  /** 条目类型（task_step / task_progress / task_completed / task_error 等） */
  type: string;
  /** 任务/步骤上下文 */
  taskId?: string;
  stepId?: string;
  /** 描述文本 */
  desc?: string;
  /** 附加数据（序列化为 JSON 的安全值） */
  detail?: Record<string, unknown>;
}

export class TrajectoryTrailRecorder {
  /** 追加一条旁路轨迹（写失败仅告警，不阻断主路径——CS03） */
  static async append(
    sessionId: string,
    entry: TrajectoryTrailEntry
  ): Promise<void> {
    if (!sessionId) return;
    const file = this.getPath(sessionId);
    try {
      await fs.mkdir(dirname(file), { recursive: true });
      const line = JSON.stringify({ ...entry, ts: Date.now() }) + '\n';
      await fs.appendFile(file, line, 'utf-8');
      await this.rotateIfNeeded(file);
    } catch (e) {
      logger.warn('旁路轨迹写入失败（不影响任务主流程）', {
        sessionId,
        error: String(e),
      });
    }
  }

  /** 会话删除时清理旁路轨迹文件 */
  static async cleanup(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const file = this.getPath(sessionId);
    try {
      await fs.rm(file, { force: true });
    } catch (e) {
      logger.debug('旁路轨迹清理失败', { sessionId, error: String(e) });
    }
  }

  /** 读取旁路轨迹（供轨迹面板回放；文件不存在返回空数组） */
  static async read(
    sessionId: string,
    limit = 500
  ): Promise<Array<Record<string, unknown>>> {
    const file = this.getPath(sessionId);
    if (!existsSync(file)) return [];
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      const tail = lines.slice(-limit);
      return tail.map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return { type: 'corrupt', desc: l.slice(0, 100) };
        }
      });
    } catch (e) {
      logger.debug('旁路轨迹读取失败', { sessionId, error: String(e) });
      return [];
    }
  }

  /** 超限轮转：截断保留最近 KEEP_LINES 行（避免单会话文件无限增长） */
  private static async rotateIfNeeded(file: string): Promise<void> {
    try {
      const stat = await fs.stat(file);
      if (stat.size <= MAX_BYTES) return;
      const raw = await fs.readFile(file, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      const kept = lines.slice(-KEEP_LINES);
      await fs.writeFile(
        file,
        kept.join('\n') + (kept.length ? '\n' : ''),
        'utf-8'
      );
      logger.info('旁路轨迹超限轮转', {
        file,
        bytes: stat.size,
        keptLines: kept.length,
      });
    } catch (e) {
      // 轮转失败不影响本次写入（下次 append 时重试）
      logger.debug('旁路轨迹轮转失败', { file, error: String(e) });
    }
  }

  private static getPath(sessionId: string): string {
    return join(resolveDataDir(), 'trajectories', `${sessionId}.jsonl`);
  }
}
