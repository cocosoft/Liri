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
 *   3. detectShellSideEffects() 在所有 afterToolOperation() 完成后调用
 *   4. finalizeRound() 最后调用
 *
 * 对应方案文档 §3.4 的 FileOperationTracker 设计
 */

import { stat, readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { getLogger } from '@modules/monitoring';
import { xxHash, encodeFilePath } from './xxHash';
import type { FileChange, FileChangeType, FileStat, ScanStatus } from './types';

const logger = getLogger('FileOperationTracker');

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

    // 计算修改前文件的 hash 用于完整性校验
    let hash: string | undefined;
    const checkPath = oldPath || operation.path;
    try {
      hash = await xxHash(checkPath);
    } catch (err) {
      // 文件可能不存在（如 deleted 操作的目标已不存在），忽略 hash 计算
    }

    this.roundChanges.set(operation.path, {
      path: operation.path,
      type,
      oldPath,
      newPath,
      backupPath: operation.backupPath,
      hash,
      originalSize: operation.originalSize,
      originalMtime: operation.originalMtime,
    });
  }

  /**
   * 路径 2——轮次开始时记录文件系统快照（用于 Shell 命令检测）
   *
   * ⚠️ 必须在任何 beforeToolOperation() 之前调用。
   * 如果已有操作被记录（roundChanges 非空），抛出断言错误。
   */
  async recordRoundStart(scanPaths: string[]): Promise<void> {
    if (this.roundChanges.size > 0) {
      throw new Error(
        `recordRoundStart 必须在 beforeToolOperation 之前调用，已有 ${this.roundChanges.size} 个操作被记录`
      );
    }

    this.roundStartSnapshot.clear();
    this.timedOut = false;
    this.scanPaths = scanPaths;

    const startTime = Date.now();
    const TIMEOUT_MS = 10_000; // 10 秒超时

    try {
      for (const scanPath of scanPaths) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          this.timedOut = true;
          logger.warn('扫描超时，标记为部分结果', {
            scanPaths,
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
        scanPaths,
      });
      this.timedOut = true;
    }
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
          if (recursive) {
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
              if (
                entry.name === 'node_modules' ||
                entry.name === '.git' ||
                entry.name === '__pycache__' ||
                entry.name === '.venv'
              )
                continue;
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
