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
 * FileIOLoopDetector — 文件读写循环检测器
 *
 * Phase 2 新增。对标 hermes file_tools.py 的按 task_id 文件循环检测。
 * 追踪对同一文件/同一区域的连续读写操作，达到阈值后阻止并告警。
 *
 * 检测逻辑（参考 hermes）：
 *   同一文件/区域连续读取第 3 次 → 警告（仍返回内容）
 *   同一文件/区域连续读取第 4+ 次 → 阻止（返回 BLOCKED 错误）
 *   任何其他工具调用（或读取不同文件/不同区域）→ 重置计数器
 *   分页（offset/limit 变化）不计为重复
 */

import { READ_TOOLS, WRITE_TOOLS } from './tool-constants.js';
import { getLogger } from '@modules/monitoring';
import {
  LOOP_OBSERVE_ONLY,
  LOOP_FILE_IO_WARNING,
  LOOP_FILE_IO_BLOCK,
} from './loop-config.js';

const logger = getLogger('query:fileIOLoopDetector');

export interface FileIOConfig {
  enabled: boolean;
  /** 警告阈值，默认 3 */
  warningThreshold: number;
  /** 阻止阈值，默认 4 */
  blockThreshold: number;
}

interface FileAccessRecord {
  filePath: string;
  /** 读取区域（offset + limit 组合） */
  region: string;
  toolName: string;
  consecutiveCount: number;
  lastAccessAt: number;
}

export interface FileIOBlockResult {
  blocked: boolean;
  warning: boolean;
  message?: string;
}

const DEFAULT_CONFIG: FileIOConfig = {
  enabled: true,
  /** 文件 IO 循环警告阈值（可通过 LOOP_FILE_IO_WARNING 环境变量覆盖） */
  warningThreshold: LOOP_FILE_IO_WARNING,
  /** 文件 IO 循环阻断阈值（可通过 LOOP_FILE_IO_BLOCK 环境变量覆盖） */
  blockThreshold: LOOP_FILE_IO_BLOCK,
};

export class FileIOLoopDetector {
  private config: FileIOConfig;
  /** 当前追踪的连续读访问（同一文件+区域） */
  private currentRead: FileAccessRecord | null = null;
  /** 当前追踪的连续写操作（同一文件） */
  private currentWrite: FileAccessRecord | null = null;
  /** 跨文件交替检测：最近访问的文件列表 */
  private recentFiles: string[] = [];
  private readonly MAX_RECENT_FILES_TRACK = 10;
  private readonly FILE_CYCLE_THRESHOLD = 6;

  constructor(config?: Partial<FileIOConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 在执行文件操作前检查
   * @param toolName 工具名称
   * @param filePath 目标文件路径
   * @param offset 分页偏移（search_files/grep 等）
   * @param limit 分页大小
   */
  checkBeforeAccess(
    toolName: string,
    filePath: string,
    offset?: number,
    limit?: number
  ): FileIOBlockResult {
    if (!this.config.enabled) return { blocked: false, warning: false };

    const normalizedPath = filePath.replace(/\\/g, '/');
    const isRead = READ_TOOLS.has(toolName);
    const isWrite = WRITE_TOOLS.has(toolName);

    if (!isRead && !isWrite) {
      this.currentRead = null;
      this.currentWrite = null;
      return { blocked: false, warning: false };
    }

    // 跨文件交替循环检测
    this.recentFiles.push(normalizedPath);
    if (this.recentFiles.length > this.MAX_RECENT_FILES_TRACK) {
      this.recentFiles.shift();
    }
    const cycleDetected = this._detectFileCycle();
    if (cycleDetected.detected) {
      return this._applyObserveOnly({
        blocked: true,
        warning: false,
        message: cycleDetected.message,
      });
    }

    // ── 读循环检测 ──
    if (isRead) {
      const region =
        offset !== undefined && limit !== undefined
          ? `offset=${offset},limit=${limit}`
          : 'full';
      const r = this.currentRead;
      if (r && r.filePath === normalizedPath && r.region === region) {
        r.consecutiveCount++;
        if (r.consecutiveCount >= this.config.blockThreshold)
          return this._applyObserveOnly({
            blocked: true,
            warning: false,
            message: `[IO] 连续读 ${filePath} ×${r.consecutiveCount}`,
          });
        if (r.consecutiveCount >= this.config.warningThreshold)
          return {
            blocked: false,
            warning: true,
            message: `[IO] 连续读 ${filePath} ×${r.consecutiveCount} (警告)`,
          };
      } else {
        this.currentRead = {
          filePath: normalizedPath,
          region,
          toolName,
          consecutiveCount: 1,
          lastAccessAt: Date.now(),
        };
      }
    }

    // ── 写循环检测 ──
    if (isWrite) {
      const w = this.currentWrite;
      if (w && w.filePath === normalizedPath) {
        w.consecutiveCount++;
        if (w.consecutiveCount >= this.config.blockThreshold)
          return this._applyObserveOnly({
            blocked: true,
            warning: false,
            message: `[IO] 连续写 ${filePath} ×${w.consecutiveCount}`,
          });
        if (w.consecutiveCount >= this.config.warningThreshold)
          return {
            blocked: false,
            warning: true,
            message: `[IO] 连续写 ${filePath} ×${w.consecutiveCount} (警告)`,
          };
      } else {
        this.currentWrite = {
          filePath: normalizedPath,
          region: 'full',
          toolName,
          consecutiveCount: 1,
          lastAccessAt: Date.now(),
        };
      }
    }

    return { blocked: false, warning: false };
  }

  /**
   * observeOnly guard：将阻断降级为警告
   */
  private _applyObserveOnly(result: FileIOBlockResult): FileIOBlockResult {
    if (result.blocked && LOOP_OBSERVE_ONLY) {
      logger.warn(`[OBSERVE] FileIOLoopDetector 本应拦截: ${result.message}`);
      return { blocked: false, warning: true, message: result.message };
    }
    return result;
  }

  /**
   * 跨文件交替循环检测
   * 最近 N 次中，某几个文件重复出现超过阈值
   */
  private _detectFileCycle(): { detected: boolean; message?: string } {
    if (this.recentFiles.length < this.FILE_CYCLE_THRESHOLD)
      return { detected: false };

    // 统计每个文件出现次数
    const freq = new Map<string, number>();
    for (const f of this.recentFiles) freq.set(f, (freq.get(f) ?? 0) + 1);

    // 如果有 2-3 个文件出现 ≥3 次，判定为交替循环
    const multiHit = [...freq.entries()].filter(([, c]) => c >= 3);
    if (multiHit.length >= 2 && multiHit.length <= 3) {
      return {
        detected: true,
        message: `[IO_CYCLE] 检测到 ${multiHit.length} 个文件交替读取循环: ${multiHit.map(([f]) => f).join(', ')}`,
      };
    }

    return { detected: false };
  }

  resetOnNonRead(): void {
    this.currentRead = null;
    this.currentWrite = null;
  }

  reset(): void {
    this.currentRead = null;
    this.currentWrite = null;
    this.recentFiles = [];
  }
}

/** 工厂函数 */
export function createFileIOLoopDetector(
  config?: Partial<FileIOConfig>
): FileIOLoopDetector {
  return new FileIOLoopDetector(config);
}
