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
 * PersonalityReflector — SOUL.md / USER.md 自动纠偏分析器
 *
 * 分析对话内容，检测是否需要更新 SOUL.md（AI 人格）或 USER.md（用户档案）。
 * 安全策略：confidence ≥ 0.8 自动写入，0.5-0.8 写入建议文件，< 0.5 仅日志。
 */

import { readFile, writeFile, stat, copyFile, mkdir } from 'fs/promises';
import {
  resolveSoulPath,
  resolveUserProfilePath,
  resolvePyappHome,
} from '@modules/core';
import { AtomicWriter } from '@modules/session';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('dream:reflect:personality');

export interface SoulAlignmentResult {
  needsUpdate: boolean;
  suggestedPatch?: string;
  reason?: string;
  confidence: number;
}

export interface UserProfileAnalysis {
  needsUpdate: boolean;
  newPreferences?: string[];
  changedPreferences?: string[];
  suggestedPatch?: string;
  reason?: string;
  confidence: number;
}

export class PersonalityReflector {
  private soulPath: string;
  private userPath: string;
  private soulSnapshotMtime: number = 0;
  private userSnapshotMtime: number = 0;
  private readonly atomicWriter = new AtomicWriter();

  constructor() {
    this.soulPath = resolveSoulPath();
    this.userPath = resolveUserProfilePath();
  }

  /** 读取当前 SOUL.md 内容并记录 mtime 快照 */
  async readCurrentSoul(): Promise<string> {
    try {
      const s = await stat(this.soulPath);
      this.soulSnapshotMtime = s.mtimeMs;
      return await readFile(this.soulPath, 'utf-8');
    } catch {
      this.soulSnapshotMtime = 0;
      return '';
    }
  }

  /** 读取当前 USER.md 内容并记录 mtime 快照 */
  async readCurrentUserProfile(): Promise<string> {
    try {
      const s = await stat(this.userPath);
      this.userSnapshotMtime = s.mtimeMs;
      return await readFile(this.userPath, 'utf-8');
    } catch {
      this.userSnapshotMtime = 0;
      return '';
    }
  }

  /**
   * 分析对话，检测 SOUL.md 是否需要调整
   * 注意：实际 LLM 调用由 UnifiedDreamCycle 的 Analyze 阶段执行，
   * 本方法提供结果接收和处理逻辑。
   */
  analyzeSoulAlignment(
    currentSoul: string,
    analysisResult: string
  ): SoulAlignmentResult {
    try {
      const parsed = this.parseAnalysisResult(analysisResult);
      const soulChanges = parsed.soul || {};

      return {
        needsUpdate: !!soulChanges.needsUpdate,
        suggestedPatch: soulChanges.suggestedPatch,
        reason: soulChanges.reason,
        confidence: soulChanges.confidence || 0,
      };
    } catch {
      logger.warn('SOUL 分析结果解析失败，使用默认');
      return { needsUpdate: false, confidence: 0 };
    }
  }

  /**
   * 分析对话，检测 USER.md 是否需要更新
   */
  analyzeUserProfileChanges(
    currentProfile: string,
    analysisResult: string
  ): UserProfileAnalysis {
    try {
      const parsed = this.parseAnalysisResult(analysisResult);
      const userChanges = parsed.user || {};

      return {
        needsUpdate: !!userChanges.needsUpdate,
        newPreferences: userChanges.newPreferences,
        changedPreferences: userChanges.changedPreferences,
        suggestedPatch: userChanges.suggestedPatch,
        confidence: userChanges.confidence || 0,
      };
    } catch {
      logger.warn('USER 分析结果解析失败，使用默认');
      return { needsUpdate: false, confidence: 0 };
    }
  }

  /**
   * 写入 SOUL.md 变更（带乐观锁保护）
   * @returns 是否成功写入
   */
  async writeSoulPatch(
    suggestedPatch: string,
    reason: string
  ): Promise<{ written: boolean; conflict: boolean }> {
    try {
      const currentMtime = (
        await stat(this.soulPath).catch(() => ({ mtimeMs: 0 }))
      ).mtimeMs;

      if (
        this.soulSnapshotMtime > 0 &&
        currentMtime !== this.soulSnapshotMtime
      ) {
        // 乐观锁：用户在梦境周期期间编辑了文件
        const conflictPath = join(
          resolvePyappHome(),
          'knowledge',
          'raw',
          `soul_conflict_${Date.now()}.md`
        );
        await mkdir(join(resolvePyappHome(), 'knowledge', 'raw'), {
          recursive: true,
        });
        await writeFile(
          conflictPath,
          `# SOUL.md 冲突\n\n用户手动编辑与梦境纠偏冲突。\n\n## 建议变更\n${suggestedPatch}\n\n## 原因\n${reason}\n`,
          'utf-8'
        );
        logger.info('SOUL.md 乐观锁冲突，已写入 conflict 文件');
        return { written: false, conflict: true };
      }

      // 备份
      const backupPath = `${this.soulPath}.bak.${Date.now()}`;
      try {
        await copyFile(this.soulPath, backupPath);
      } catch {
        /* no existing file to backup */
      }

      // 追加变更（原子写：tmp+rename，防止写入中途崩溃损坏核心文件）
      const current = await readFile(this.soulPath, 'utf-8').catch(() => '');
      const updated =
        current +
        `\n\n<!-- 梦境纠偏 (${new Date().toISOString()}) -->\n${suggestedPatch}`;
      await this.atomicWriter.write(this.soulPath, updated);

      logger.info('SOUL.md 已更新', { reason });
      return { written: true, conflict: false };
    } catch (e) {
      logger.error('SOUL.md 写入失败', { error: String(e) });
      return { written: false, conflict: false };
    }
  }

  /**
   * 写入 USER.md 变更（带乐观锁保护）
   */
  async writeUserPatch(
    suggestedPatch: string,
    reason: string
  ): Promise<{ written: boolean; conflict: boolean }> {
    try {
      const currentMtime = (
        await stat(this.userPath).catch(() => ({ mtimeMs: 0 }))
      ).mtimeMs;

      if (
        this.userSnapshotMtime > 0 &&
        currentMtime !== this.userSnapshotMtime
      ) {
        const conflictPath = join(
          resolvePyappHome(),
          'knowledge',
          'raw',
          `user_conflict_${Date.now()}.md`
        );
        await mkdir(join(resolvePyappHome(), 'knowledge', 'raw'), {
          recursive: true,
        });
        await writeFile(
          conflictPath,
          `# USER.md 冲突\n\n用户手动编辑与梦境纠偏冲突。\n\n## 建议变更\n${suggestedPatch}\n\n## 原因\n${reason}\n`,
          'utf-8'
        );
        logger.info('USER.md 乐观锁冲突，已写入 conflict 文件');
        return { written: false, conflict: true };
      }

      const backupPath = `${this.userPath}.bak.${Date.now()}`;
      try {
        await copyFile(this.userPath, backupPath);
      } catch {
        /* no existing file to backup */
      }

      // 追加变更（原子写：tmp+rename，防止写入中途崩溃损坏核心文件）
      const current = await readFile(this.userPath, 'utf-8').catch(() => '');
      const updated =
        current +
        `\n\n<!-- 梦境纠偏 (${new Date().toISOString()}) -->\n${suggestedPatch}`;
      await this.atomicWriter.write(this.userPath, updated);

      logger.info('USER.md 已更新', { reason });
      return { written: true, conflict: false };
    } catch (e) {
      logger.error('USER.md 写入失败', { error: String(e) });
      return { written: false, conflict: false };
    }
  }

  /** 写入低置信度建议到 knowledge/raw/ */
  async writeSuggestionsFile(
    suggestions: string,
    type: 'soul' | 'user',
    targetPath?: string
  ): Promise<void> {
    const suggestionsPath =
      targetPath ??
      join(
        resolvePyappHome(),
        'knowledge',
        'raw',
        `personality_suggestions_${type}_${Date.now()}.md`
      );
    await mkdir(join(resolvePyappHome(), 'knowledge', 'raw'), {
      recursive: true,
    });
    await this.atomicWriter.write(suggestionsPath, suggestions);
    logger.info(`低置信度 ${type} 建议已写入`, { path: suggestionsPath });
  }

  /** 解析 LLM 返回的分析结果 JSON */
  private parseAnalysisResult(result: string): Record<string, any> {
    // 尝试直接解析 JSON
    try {
      return JSON.parse(result);
    } catch {
      // 尝试提取 JSON 块
      const match = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        try {
          return JSON.parse(match[1].trim());
        } catch {
          /* fall through */
        }
      }
    }
    return {};
  }
}
