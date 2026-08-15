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
 * SkillHotReloader — 技能文件热重载（T3.2）
 *
 * 对齐论文 Algorithm 8：备份旧定义 → 装载新定义（schema 校验）→
 * 失败回滚旧定义 + 上报；无法判定的更新默认拒绝（保守回退）。
 *
 * 复用 ConfigReloader 的 fs.watch 基础设施（ConfigWatcher），
 * 并处理 Windows fs.watch 现实：
 * - 事件 debounce（200ms）：防 rename+change 双事件重复触发
 * - 内容哈希比较：仅内容变化才触发重载（防编辑器原子保存中间态）
 *
 * 回滚语义：handler 由调用方注入（如 SkillRegistry.register 覆盖），
 * 校验失败时 handler 返回 { valid: false } 且不覆盖旧定义 → 旧定义保留。
 */

import { readFileSync } from 'fs';
import crypto from 'crypto';
import { ConfigWatcher } from '@modules/config/ConfigReloader';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('skills:hotreload');

export interface SkillFileChange {
  filePath: string;
  content: string;
}

export interface SkillReloadResult {
  valid: boolean;
  errors: string[];
}

/**
 * 变更处理回调：解析 + schema 校验 + 装载（成功覆盖旧定义，失败返回错误）。
 * 返回 { valid: false, errors } 表示校验失败 → 旧定义保留（回滚）。
 */
export type SkillChangeHandler = (
  change: SkillFileChange
) => Promise<SkillReloadResult> | SkillReloadResult;

export interface SkillHotReloaderOptions {
  /** 事件 debounce（毫秒，默认 200） */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 200;

export class SkillHotReloader {
  private watcher: ConfigWatcher;
  private contentHashes = new Map<string, string>();
  private handler: SkillChangeHandler | null = null;

  constructor(options: SkillHotReloaderOptions = {}) {
    this.watcher = new ConfigWatcher(options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.watcher.on('change', (event: { filePath: string }) => {
      void this.handleFileChange(event.filePath);
    });
  }

  /** 设置技能文件变更处理回调（装载 + 校验 + 回滚语义） */
  setHandler(handler: SkillChangeHandler): void {
    this.handler = handler;
  }

  /** 开始监听技能目录 */
  start(dirs: string[]): void {
    this.watcher.start(dirs);
    logger.info(`技能热重载已启动: ${dirs.join(', ')}`);
  }

  /** 停止监听 */
  stop(): void {
    this.watcher.stop();
    this.contentHashes.clear();
  }

  /** 记录目录内现有文件的基线哈希（启动时调用，避免首轮误触发） */
  seedBaseline(filePaths: string[]): void {
    for (const filePath of filePaths) {
      try {
        this.contentHashes.set(filePath, this.hashFile(filePath));
      } catch {
        // @ignore-catch — 文件不可读时跳过基线记录（后续真实变更仍触发）
      }
    }
  }

  /**
   * 主动触发一次重载（供测试/手动触发）。
   * 仅当内容哈希变化时执行 handler；无 handler 时视为跳过。
   */
  async reloadFile(filePath: string): Promise<SkillReloadResult | null> {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (error) {
      logger.error('技能文件读取失败', { filePath, error: String(error) });
      return { valid: false, errors: [`读取失败: ${String(error)}`] };
    }

    const current = this.hashContent(content);
    const previous = this.contentHashes.get(filePath);
    // 内容未变（touch/编辑器原子保存中间态）→ 跳过
    if (current === previous) return null;

    this.contentHashes.set(filePath, current);
    if (!this.handler) return null;

    try {
      const result = await this.handler({ filePath, content });
      if (!result.valid) {
        // 校验失败：回滚 = 不覆盖旧定义 + 上报
        logger.error('技能热重载校验失败，保留旧定义', {
          filePath,
          errors: result.errors,
        });
      } else {
        logger.info('技能热重载成功', { filePath });
      }
      return result;
    } catch (error) {
      // handler 抛错 = 无法判定 → 保守拒绝（保留旧定义）
      logger.error('技能热重载异常，保守拒绝', {
        filePath,
        error: String(error),
      });
      return { valid: false, errors: [String(error)] };
    }
  }

  private handleFileChange(filePath: string): void {
    if (!this.handler) return;
    void this.reloadFile(filePath);
  }

  private hashFile(filePath: string): string {
    const content = readFileSync(filePath, 'utf-8');
    return this.hashContent(content);
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

/** 全局单例 */
export const skillHotReloader = new SkillHotReloader();
