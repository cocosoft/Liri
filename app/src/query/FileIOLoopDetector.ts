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
  isLoopObserveOnly,
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
  /** 查询签名（`glob` / `grep` 的 pattern；缺省=无查询语义） */
  querySignature?: string;
  toolName: string;
  consecutiveCount: number;
  lastAccessAt: number;
}

export interface FileIOBlockResult {
  blocked: boolean;
  warning: boolean;
  message?: string;
}

/** 访问键的**路径部分**（去掉 `\u0000<查询签名>` 尾巴） */
function pathPartOfKey(key: string): string {
  const i = key.indexOf('\u0000');
  return i < 0 ? key : key.slice(0, i);
}

/** 访问键的**查询签名部分**（无签名 ⇒ 空串） */
function signatureOfKey(key: string): string {
  const i = key.indexOf('\u0000');
  return i < 0 ? '' : key.slice(i + 1);
}

/**
 * 两个访问键是否指向**同一个物理文件的同一种查询**。
 *
 * 2026-10-31 修（真机 `app.log` 实证）：模型会在**绝对**（`C:/…/output/PRD.md`）与
 * **相对**（`output/PRD.md`）写法间来回切换，旧实现按原始字符串入键 ⇒ 同一文件被当成
 * 两个文件交替，触发 `[IO_CYCLE] 检测到 2 个文件交替读取循环` 并**终止整轮**。
 * 判据：查询签名必须相同（不同 pattern = 不同查询，见 `querySignature` 口径），
 * 且路径相等或一方是另一方的尾部（按 `/` 边界）。
 */
function isSameAccessTarget(a: string, b: string): boolean {
  if (signatureOfKey(a) !== signatureOfKey(b)) return false;
  const pa = pathPartOfKey(a);
  const pb = pathPartOfKey(b);
  if (pa === pb) return true;
  const [short, long] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return long.endsWith(`/${short}`);
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

  constructor(config?: Partial<FileIOConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 在执行文件操作前检查
   * @param toolName 工具名称
   * @param filePath 目标文件路径
   * @param offset 分页偏移（search_files/grep 等）
   * @param limit 分页大小
   * @param querySignature 该次调用的**查询签名**（如 `glob` / `grep` 的 `pattern`）。
   *   2026-10-31：此前判定键只有「路径 + 分页区域」，同一目录下**不同 pattern** 的连续
   *   检索（`**‌/*` → `package.json` → `src/**` …）被算成「连续读同一文件」，第 4 次直接
   *   **终止整轮**（真机 app.log：单窗口 `文件IO循环已被阻止` 346–434 次，均为 `glob` 指向
   *   同一工作区根）。不同 pattern = 不同查询 ⇒ 计入键后不再互相叠加。
   */
  checkBeforeAccess(
    toolName: string,
    filePath: string,
    offset?: number,
    limit?: number,
    querySignature?: string
  ): FileIOBlockResult {
    if (!this.config.enabled) return { blocked: false, warning: false };

    // 去掉前导 `./`（`./a` 与 `a` 是同一目标）；裸 `.` 无法在无 cwd 时比较 ⇒ 不参与重复计数
    const normalizedPath = filePath
      .replace(/\\/g, '/')
      .replace(/^(?:\.\/)+/, '');
    const isRead = READ_TOOLS.has(toolName);
    const isWrite = WRITE_TOOLS.has(toolName);

    if (!isRead && !isWrite) {
      this.currentRead = null;
      this.currentWrite = null;
      return { blocked: false, warning: false };
    }

    /** 判定键：路径 + 查询签名（不同 pattern 不互相叠加） */
    const accessKey = querySignature
      ? `${normalizedPath}\u0000${querySignature}`
      : normalizedPath;

    // 重复目标检测（2026-10-31 口径：**只拦同一目标重复**）
    // ① 同一文件的绝对/相对写法归一到**已有键**（详见 `isSameAccessTarget`）；
    // ② 裸 `.`（当前目录）无 cwd 时无法比较 ⇒ **不计入**（漏检不误检），避免
    //    「绝对路径 vs `.`」这种同一目录的两种写法互相叠加（真机 app.log 实证误判）。
    if (normalizedPath !== '.' && normalizedPath !== '') {
      const sameTargetKey = this.recentFiles.find((k) =>
        isSameAccessTarget(k, accessKey)
      );
      this.recentFiles.push(sameTargetKey ?? accessKey);
      if (this.recentFiles.length > this.MAX_RECENT_FILES_TRACK) {
        this.recentFiles.shift();
      }
    }

    // ── 读循环检测 ──
    if (isRead) {
      const region =
        offset !== undefined && limit !== undefined
          ? `offset=${offset},limit=${limit}`
          : 'full';
      const r = this.currentRead;
      if (
        r &&
        r.filePath === normalizedPath &&
        r.region === region &&
        r.querySignature === querySignature
      ) {
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
          querySignature,
          toolName,
          consecutiveCount: 1,
          lastAccessAt: Date.now(),
        };
      }
    }

    // ── 写循环检测 ──
    if (isWrite) {
      const w = this.currentWrite;
      if (
        w &&
        w.filePath === normalizedPath &&
        w.querySignature === querySignature
      ) {
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
          querySignature,
          toolName,
          consecutiveCount: 1,
          lastAccessAt: Date.now(),
        };
      }
    }

    // 窗口内「同一目标重复」兜底（放在连续读写判定**之后**：连续场景优先用更具体的
    // 「连续读/写 ×N」文案；本判据只覆盖**非连续**重复，如 A、B、A、C、A、D、A）。
    const repeatDetected = this._detectRepeatedTarget();
    if (repeatDetected.detected) {
      return this._applyObserveOnly({
        blocked: true,
        warning: false,
        message: repeatDetected.message,
      });
    }

    return { blocked: false, warning: false };
  }

  /**
   * observeOnly guard：将阻断降级为警告
   */
  private _applyObserveOnly(result: FileIOBlockResult): FileIOBlockResult {
    if (result.blocked && isLoopObserveOnly()) {
      logger.warn(`[OBSERVE] FileIOLoopDetector 本应拦截: ${result.message}`);
      return { blocked: false, warning: true, message: result.message };
    }
    return result;
  }

  /**
   * 同一目标在最近窗口内**重复**访问（2026-10-31 用户口径：交叉文件判定只认「同一目标重复」）。
   *
   * 旧启发式「最近 10 次里任意 2–3 个键各出现 ≥3 次 ⇒ 交替循环」会把**两个不同目标交替探索**
   * （如 `output/**` 与 `01_work/**` 交替 glob）判成循环并终止整轮；交替访问不同目标本身不构成
   * 循环（乒乓判据由 `query:loopConfig.pingPongThreshold` 负责）。
   *
   * 现判据：**单个** target 在窗口内出现次数 ≥ `blockThreshold`（默认 4）。
   */
  private _detectRepeatedTarget(): { detected: boolean; message?: string } {
    if (this.recentFiles.length < this.config.blockThreshold) {
      return { detected: false };
    }
    const freq = new Map<string, number>();
    for (const key of this.recentFiles) {
      const n = (freq.get(key) ?? 0) + 1;
      freq.set(key, n);
      if (n >= this.config.blockThreshold) {
        return {
          detected: true,
          message: `[IO_REPEAT] 最近 ${this.recentFiles.length} 次访问中，同一目标重复 ×${n}（${pathPartOfKey(key)}）`,
        };
      }
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
