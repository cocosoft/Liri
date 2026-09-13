// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, modify, copy, merge, publish, distribute, sublicense, and/or sell
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
 * AI 文件操作代理层
 *
 * 支持两条追踪路径：
 *   路径 1：显式文件工具调用（Write / Edit / Delete / Rename / Move / Copy）
 *   路径 2：Shell 命令执行结果的文件系统扫描（对比轮次前后的文件状态）
 *
 * ⚠️ 调用顺序约束（违反会导致 Shell 副作用检测假阴或备份不完整）：
 *   1. recordRoundStart() 必须在任何 beforeToolOperation() 之前调用
 *   2. beforeToolOperation() 始终在 recordRoundStart() 之后
 *   3. ensureRoundStartSnapshot() 在**本轮首个 shell 工具执行之前**调用（懒快照，幂等）
 *   4. detectShellSideEffects() 在**轮内全部工具执行完成后**调用
 *   5. finalizeRound() 最后调用 —— 写入轮末哈希与后置备份
 *
 * 备份与哈希语义（O38 根因修复，2026-09-12）：
 *   - `backupPath`      ← **操作前**内容，撤销的唯一还原来源（beforeToolOperation 内落盘）
 *   - `afterBackupPath` ← **轮末**内容，重做的来源（finalizeRound 内落盘）
 *   - `hash`            ← **轮末**内容哈希（finalizeRound 写入）——
 *     撤销时用它与当前文件比对判定"轮末之后是否被人改过"，故必须是轮末值而非操作前值
 *
 * 对应方案文档 §3.4 的 FileOperationTracker 设计
 */

import { stat, readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { getLogger } from '@modules/monitoring';
import { xxHash, xxHashBuffer, encodeFilePath } from './xxHash';
import { saveFileBackup } from './SnapshotStorage';
import type { FileChange, FileChangeType, FileStat, ScanStatus } from './types';

const logger = getLogger('FileOperationTracker');

/**
 * 轮次文件扫描的排除目录（O43 留档项「scanPaths 收窄」，2026-09-13）
 *
 * 原状态：**只有**新文件检测（`detectShellSideEffects` 内的 `collectNewFiles`）排除这些目录，
 * 而轮次起始快照（`scanDirectory`）是全量递归 → `.git` / `node_modules` 下数千文件进入
 * `roundStartSnapshot`，随后 `detectShellSideEffects` 把 `.git` 抖动一律登记为变更
 * （O43 实测：单轮数千条 `scan` 变更，后置备份一度达 3,587 文件/10s）。
 *
 * 现收敛为唯一常量、两处遍历共用：只扫描 AI 可能改动的源码/产物目录，不扫描版本库与依赖缓存。
 * 语义代价（如实记录）：shell 在 `.git` / `node_modules` 内的改动不再被登记 —— 这类改动本就
 * 无操作前备份、不可精确恢复（`source: 'scan'`），登记它只有噪音没有可撤销性。
 */
const SCAN_EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
]);

/**
 * 文件操作追踪器
 */
export class FileOperationTracker {
  /** 当前轮次的文件变更集合（path → FileChange） */
  private roundChanges: Map<string, FileChange> = new Map();

  /** 轮次开始时的文件系统快照（path → FileStat） */
  private roundStartSnapshot: Map<string, FileStat> = new Map();

  /** 扫描是否超时（部分结果） */
  private timedOut: boolean = false;

  /** 轮次开始时扫描的路径列表（用于 detectShellSideEffects 检测新文件） */
  private scanPaths: string[] = [];

  /** 轮次起始快照是否已建立（懒快照，见 ensureRoundStartSnapshot） */
  private snapshotTaken: boolean = false;

  /** 当前会话 ID（备份落盘路径所需，由 recordRoundStart 注入） */
  private sessionId: string = '';

  /** 当前轮次编号（备份落盘路径所需，由 recordRoundStart 注入） */
  private roundId: number = 0;

  /**
   * 路径 1：在 AI 执行文件工具调用前调用
   * 记录文件的"操作前状态"
   *
   * 必须先调用 recordRoundStart()，否则抛出断言错误。
   */
  async beforeToolOperation(operation: FileOperation): Promise<void> {
    if (operation.type === 'created') {
      // 新建文件不需要操作前备份
      this.roundChanges.set(operation.path, {
        path: operation.path,
        type: 'created',
        source: 'tool',
      });
      return;
    }

    let oldPath: string | undefined;
    let newPath: string | undefined;
    let type: FileChangeType = 'modified';

    if (operation.type === 'renamed') {
      type = 'renamed';
      oldPath = operation.oldPath!;
      newPath = operation.newPath!;
    } else if (operation.type === 'moved') {
      type = 'moved';
      oldPath = operation.oldPath!;
      newPath = operation.newPath!;
    } else if (operation.type === 'deleted') {
      type = 'deleted';
    }

    // ── 操作前备份（O38 根因修复，2026-09-12）：撤销的**唯一**还原来源 ──
    // 此前该字段仅由调用方透传，而唯一调用点只传 {path, type} → 备份恒为空 → 撤销静默无效。
    const sourcePath = oldPath || operation.path;
    const sourceExists = existsSync(sourcePath);
    let backupPath = operation.backupPath;
    if (!backupPath && sourceExists) {
      try {
        backupPath = await saveFileBackup(
          this.sessionId,
          this.roundId,
          operation.path,
          await readFile(sourcePath)
        );
      } catch (err) {
        logger.warn('操作前备份落盘失败，该文件将无法撤销', {
          path: sourcePath,
          error: String(err),
        });
      }
    }
    if (!sourceExists && type === 'modified') {
      // 操作前文件不存在 → 本轮实为"新建"。
      // （file_write 的覆写与新建共用工具名，只能按操作前是否存在区分。）
      // 判为 created 才能让撤销删除它，否则会留下残余文件。
      type = 'created';
    }

    this.roundChanges.set(operation.path, {
      path: operation.path,
      type,
      oldPath,
      newPath,
      backupPath,
      source: 'tool',
      // ⚠️ 此处**不写** hash：hash 语义为"轮末哈希"，由 finalizeRound() 写入。
      // 旧实现在此写"操作前哈希"，导致撤销守卫拿它比对轮末内容 → 必然不等 → 一律跳过（O38）。
      originalSize: operation.originalSize,
      originalMtime: operation.originalMtime,
    });
  }

  /**
   * 路径 2——轮次开始：登记会话/轮次并清空状态（**不扫描**）
   *
   * ⚠️ 必须在任何 beforeToolOperation() 之前调用。
   * 如果已有操作被记录（roundChanges 非空），抛出断言错误。
   *
   * 轮次起始快照改为**懒执行**（见 `ensureRoundStartSnapshot`）：整仓扫描实测
   * 85,878 文件 / 5.6s，而绝大多数轮次根本不执行 shell 工具 —— 无 shell 即无 shell 副作用。
   *
   * @param sessionId 当前会话 ID（备份落盘路径所需）
   * @param roundId 当前轮次编号（备份落盘路径所需）
   * @param scanPaths 需要扫描的目录路径（懒快照时使用）
   */
  async recordRoundStart(
    sessionId: string,
    roundId: number,
    scanPaths: string[]
  ): Promise<void> {
    if (this.roundChanges.size > 0) {
      throw new Error(
        `recordRoundStart 必须在 beforeToolOperation 之前调用，已有 ${this.roundChanges.size} 个操作被记录`
      );
    }

    this.sessionId = sessionId;
    this.roundId = roundId;
    this.roundStartSnapshot.clear();
    this.timedOut = false;
    this.scanPaths = scanPaths;
    this.snapshotTaken = false;
  }

  /**
   * 懒快照：本轮**首个 shell 工具执行之前**建立基线（幂等）
   *
   * 语义要求：基线必须严格早于任何 shell 命令，否则 shell 自身的改动会被当成基线。
   * 触发点见 `ToolExecutionService._executeInternal`（`isShellToolName` 判定）。
   * 若整轮未调用本方法，`detectShellSideEffects()` 直接判定"无 shell 副作用"。
   */
  async ensureRoundStartSnapshot(): Promise<void> {
    if (this.snapshotTaken) return;
    // 先置位再扫描：并发到达的第二个 shell 工具不应重复扫描
    this.snapshotTaken = true;

    const startTime = Date.now();
    const TIMEOUT_MS = 10_000; // 10 秒超时

    try {
      for (const scanPath of this.scanPaths) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          this.timedOut = true;
          logger.warn('扫描超时，标记为部分结果', {
            scanPaths: this.scanPaths,
            elapsed: Date.now() - startTime,
          });
          break;
        }

        // 直接扫描指定路径下的文件（不递归 glob 以避免性能问题）
        await this.scanDirectory(
          scanPath,
          /* recursive */ true,
          startTime,
          TIMEOUT_MS
        );
      }
    } catch (error) {
      logger.warn('扫描出错，标记为部分结果', {
        error: String(error),
        scanPaths: this.scanPaths,
      });
      this.timedOut = true;
    }

    logger.info('回滚：shell 前基线快照已建立', {
      sessionId: this.sessionId,
      roundId: this.roundId,
      files: this.roundStartSnapshot.size,
      elapsed: Date.now() - startTime,
      timedOut: this.timedOut,
    });
  }

  /**
   * 扫描单个目录下的文件
   */
  private async scanDirectory(
    dirPath: string,
    recursive: boolean,
    startTime: number,
    timeoutMs: number
  ): Promise<void> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (Date.now() - startTime > timeoutMs) {
          this.timedOut = true;
          return;
        }

        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (recursive && !SCAN_EXCLUDED_DIRS.has(entry.name)) {
            await this.scanDirectory(fullPath, recursive, startTime, timeoutMs);
          }
        } else if (entry.isFile()) {
          try {
            const fileStat = await stat(fullPath);
            this.roundStartSnapshot.set(fullPath, {
              size: fileStat.size,
              mtime: fileStat.mtime.toISOString(),
            });
          } catch (err) {
            // 文件可能在 stat 前被删除，忽略
          }
        }
      }
    } catch (err) {
      // 目录可能不可读，忽略
    }
  }

  /**
   * 路径 2：检测 Shell 命令的副作用
   * 对比轮次开始时的文件系统和当前文件系统
   */
  async detectShellSideEffects(): Promise<{ scanStatus: ScanStatus }> {
    // 懒快照从未建立 ⟺ 本轮没执行过 shell 工具 ⟺ 不可能有 shell 副作用
    //（基线只在首个 shell 工具执行前建立，见 ensureRoundStartSnapshot）
    if (!this.snapshotTaken) {
      return { scanStatus: 'complete' };
    }

    // 获取当前文件系统状态
    const currentFiles = new Map<string, FileStat>();

    // 重新扫描之前记录的路径
    for (const [filePath] of this.roundStartSnapshot) {
      try {
        const fileStat = await stat(filePath);
        currentFiles.set(filePath, {
          size: fileStat.size,
          mtime: fileStat.mtime.toISOString(),
        });
      } catch (err) {
        // 文件已被删除
      }
    }

    // 检查被删除的文件（在 roundStartSnapshot 中存在，在当前文件系统中不存在）
    for (const [file, startStat] of this.roundStartSnapshot) {
      if (!currentFiles.has(file) && !this.roundChanges.has(file)) {
        // Shell 删除的文件，没有备份，无法精确恢复
        this.roundChanges.set(file, {
          path: file,
          type: 'deleted',
          originalSize: startStat.size,
          source: 'scan',
          // ⚠️ 无法恢复——Shell 已经删了，没有备份
        });
      }
    }

    // 检查被修改的文件（在 roundStartSnapshot 中存在，但大小或 mtime 改变）
    for (const [file, startStat] of this.roundStartSnapshot) {
      const currentStat = currentFiles.get(file);
      if (currentStat && !this.roundChanges.has(file)) {
        if (
          currentStat.size !== startStat.size ||
          currentStat.mtime !== startStat.mtime
        ) {
          // ⚠️ 无法精确恢复——Shell 已经覆盖了，没有操作前备份
          // 记录 hash，至少用于回滚前的完整性校验
          const hash = await xxHash(file).catch(() => undefined);
          this.roundChanges.set(file, {
            path: file,
            type: 'modified',
            originalSize: startStat.size,
            originalMtime: startStat.mtime,
            hash,
            source: 'scan',
          });
        }
      }
    }

    // === P1: Shell 新文件追踪 ===
    // 重新扫描 scanPaths，检测在 roundStartSnapshot 中不存在的文件
    if (this.scanPaths.length > 0) {
      const newFiles = new Set<string>();
      const startTime = Date.now();
      const TIMEOUT_MS = 5_000;

      const collectNewFiles = async (dirPath: string): Promise<void> => {
        if (Date.now() - startTime > TIMEOUT_MS) return;
        try {
          const entries = await readdir(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (Date.now() - startTime > TIMEOUT_MS) return;
            const fullPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
              if (SCAN_EXCLUDED_DIRS.has(entry.name)) continue;
              await collectNewFiles(fullPath);
            } else {
              newFiles.add(fullPath);
            }
          }
        } catch {
          // 目录不可读
        }
      };

      for (const scanPath of this.scanPaths) {
        await collectNewFiles(scanPath);
      }

      for (const filePath of newFiles) {
        if (
          !this.roundStartSnapshot.has(filePath) &&
          !this.roundChanges.has(filePath)
        ) {
          try {
            await stat(filePath);
            this.roundChanges.set(filePath, {
              path: filePath,
              type: 'created',
              originalSize: 0,
              source: 'scan',
            });
          } catch {
            // 文件在扫描后被删除
          }
        }
      }
    }

    return { scanStatus: this.timedOut ? 'partial' : 'complete' };
  }

  /**
   * 获取无法精确恢复的文件列表（Shell 操作的副作用）
   */
  getUnrestorableFiles(): FileChange[] {
    return [...this.roundChanges.values()].filter(
      (c) => !c.backupPath && !c.afterBackupPath && c.type !== 'created'
    );
  }

  /**
   * 获取当前轮次的所有变更
   */
  getChanges(): FileChange[] {
    return [...this.roundChanges.values()];
  }

  /**
   * 轮次收尾（O38 根因修复，2026-09-12）：写入**轮末**哈希与后置备份
   *
   * 该方法是设计中"缺掉的后半闭环"（原注释引用的 `afterToolOperation` / `finalizeRound`
   * 全仓无实现）。必须在**轮内全部工具执行完成后**、`detectShellSideEffects()` 之后调用。
   *
   * 为什么在轮末而非每个工具执行后：
   *   轮次快照以"路径"为粒度（`roundChanges` 按 path 归并），同轮内对同一文件的多次写入
   *   只保留最终态；轮末采集与之语义等价，且无需在每个工具返回路径上接线（少一处漏接线风险）。
   *
   * @param storeAfterVersion 是否落盘后置备份（供重做）；与 `RoundSnapshot.storeAfterVersion` 同义
   */
  async finalizeRound(storeAfterVersion: boolean): Promise<void> {
    for (const change of this.roundChanges.values()) {
      // O43 根因修复（2026-09-13）：仅对**工具实际触及**的变更做轮末哈希与后置备份。
      // 此前对 `detectShellSideEffects` 扫出的全仓变更也逐份复制 → 单轮产生数千文件、
      // GB 级 I/O（实测 10 秒 +3,587 文件仍在增长）→ 轮次收尾永不完成 → SSE 永不收尾（O43）。
      // scan 来源本就无操作前备份、无法精确恢复，做全量后置备份无收益只有代价。
      if (change.source !== 'tool') continue;
      const currentPath = change.newPath ?? change.path;

      if (!existsSync(currentPath)) {
        // 轮末文件不存在：操作前有备份 → 本轮实为"删除"（撤销需恢复它）
        if (change.backupPath && change.type === 'modified') {
          change.type = 'deleted';
        }
        continue;
      }

      let content: Buffer;
      try {
        content = await readFile(currentPath);
      } catch (err) {
        logger.warn('轮末读取失败，跳过哈希与后置备份', {
          path: currentPath,
          error: String(err),
        });
        continue;
      }

      // 轮末哈希 —— 撤销守卫的比对基准（见文件头"备份与哈希语义"）
      change.hash = xxHashBuffer(content);

      if (storeAfterVersion && !change.afterBackupPath) {
        try {
          change.afterBackupPath = await saveFileBackup(
            this.sessionId,
            this.roundId,
            currentPath,
            content,
            'after'
          );
        } catch (err) {
          logger.warn('后置备份落盘失败，该文件将无法重做', {
            path: currentPath,
            error: String(err),
          });
        }
      }
    }
  }

  /**
   * 解析 AI 回复中的 [FILE_OPERATION] 声明
   *
   * 格式：[FILE_OPERATION] <create|modify|delete> <文件路径>
   * 示例：
   *   [FILE_OPERATION] create src/utils.ts
   *   [FILE_OPERATION] modify package.json
   *   [FILE_OPERATION] delete temp.log
   *
   * @param text AI 回复文本
   * @param projectRoot 项目根目录（用于解析相对路径）
   * @returns 解析出的文件操作声明列表
   */
  static parseFileOperationDeclarations(
    text: string,
    projectRoot: string
  ): Array<{ type: FileChangeType; path: string }> {
    const declarations: Array<{ type: FileChangeType; path: string }> = [];
    const regex =
      /\[FILE_OPERATION\]\s+(create|modify|delete)\s+(.+?)(?:\n|$)/gi;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const type = match[1]!.toLowerCase() as FileChangeType;
      const rawPath = match[2]!.trim();

      // 解析为绝对路径
      const absPath = resolve(projectRoot, rawPath);

      declarations.push({ type, path: absPath });
    }

    return declarations;
  }

  /**
   * 合并外部变更记录到当前轮次
   *
   * 用于子 Agent 操作继承：子 Agent 的 Shell 副作用检测结果（file_create / file_delete）
   * 合并到父会话的 FileOperationTracker 中，确保父会话回退时撤消子 Agent 文件操作。
   *
   * 合并规则：若同路径已存在记录，保留已有（父会话的直接操作优先于子 Agent 继承）。
   *
   * @param externalChanges 外部变更记录（来自子 Agent 的 tracker）
   */
  mergeChanges(externalChanges: FileChange[]): void {
    for (const change of externalChanges) {
      if (!this.roundChanges.has(change.path)) {
        this.roundChanges.set(change.path, change);
      }
    }
  }

  /**
   * 获取变更数量
   */
  get changeCount(): number {
    return this.roundChanges.size;
  }

  /**
   * 获取扫描状态
   */
  get scanStatus(): ScanStatus {
    return this.timedOut ? 'partial' : 'complete';
  }

  /**
   * 清空所有状态（用于轮次开始前的重置）
   */
  reset(): void {
    this.roundChanges.clear();
    this.roundStartSnapshot.clear();
    this.timedOut = false;
    this.scanPaths = [];
  }
}

/**
 * 文件操作接口——用于 beforeToolOperation 的输入参数
 */
export interface FileOperation {
  /** 文件绝对路径 */
  path: string;

  /** 操作类型 */
  type: 'created' | 'deleted' | 'modified' | 'renamed' | 'moved';

  /** 修改前的备份路径（由调用方创建） */
  backupPath?: string;

  /** 修改前的文件大小 */
  originalSize?: number;

  /** 修改前的文件修改时间 */
  originalMtime?: string;

  /** renamed/moved 操作的旧路径 */
  oldPath?: string;

  /** renamed/moved 操作的新路径 */
  newPath?: string;
}
