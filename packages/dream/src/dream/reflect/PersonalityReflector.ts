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
} from '@openliri/infra/environment';
import { AtomicWriter } from '@modules/session';
import { join } from 'path';
import { getLogger } from '@openliri/infra/monitoring';
import { resolveAiAccess } from '@openliri/kernel/spi';
const logger = getLogger('dream:reflect:personality');

/** 人格分析输入 */
export interface PersonalityAnalysisInput {
  /** 当前 SOUL.md 内容 */
  soul: string;
  /** 当前 USER.md 内容 */
  user: string;
  /** 高价值会话片段（调用方已截断；空数组 ⇒ 不调用模型） */
  sessionExcerpts: string[];
}

/**
 * 可注入依赖（缺省走 `resolveAiAccess()`；单测注入桩，避免依赖真实 provider 装配）。
 */
export interface PersonalityAnalysisDeps {
  resolveAi?: () => {
    getModelRouter(): unknown;
    getProviderRegistry(): unknown;
    createToolAwareClient(provider: unknown): unknown;
  };
}

/** 人格分析提示词里的会话片段总上限（字符） */
const MAX_PERSONALITY_EXCERPT_CHARS = 12_000;
/** 单条会话片段上限（字符） */
const MAX_SINGLE_EXCERPT_CHARS = 3_000;

/**
 * 构造人格/偏好分析提示词（导出供单测锁定"真实观测确实进入提示词"）。
 *
 * 只要求模型**给出结构化结论**，不在这里做写盘判定；写入仍由
 * `analyzeSoulAlignment` / `analyzeUserProfileChanges` 的 confidence 阈值把关。
 */
export function buildPersonalityAnalysisPrompt(
  input: PersonalityAnalysisInput
): string {
  const excerpts: string[] = [];
  let used = 0;
  for (const excerpt of input.sessionExcerpts) {
    if (used >= MAX_PERSONALITY_EXCERPT_CHARS) break;
    const piece = excerpt.slice(0, MAX_SINGLE_EXCERPT_CHARS);
    excerpts.push(piece);
    used += piece.length;
  }

  return [
    '你是人格与偏好分析器。请只依据下面的**真实观测**（SOUL.md、USER.md、最近的会话片段），',
    '判断是否需要更新「AI 人格（SOUL）」或「用户档案（USER）」。',
    '',
    '严格规则：',
    '1. 证据不足或只是单次偶发表述 ⇒ needsUpdate=false（宁缺毋滥，不要为了"有产出"而编造）；',
    '2. suggestedPatch 必须是可直接追加到文件末尾的 Markdown 片段（不要重写整份文件）；',
    '3. confidence 为 0..1 的小数，表示你对"该变更是稳定偏好/事实"的把握；',
    '4. **只输出 JSON**，不要解释、不要 Markdown 代码围栏。',
    '',
    '输出结构：',
    '{"soul":{"needsUpdate":false,"suggestedPatch":"","reason":"","confidence":0},',
    ' "user":{"needsUpdate":false,"newPreferences":[],"changedPreferences":[],"suggestedPatch":"","reason":"","confidence":0}}',
    '',
    '## 当前 SOUL.md',
    input.soul.trim() || '（空文件）',
    '',
    '## 当前 USER.md',
    input.user.trim() || '（空文件）',
    '',
    '## 最近的会话观测（高价值会话片段）',
    excerpts.length > 0
      ? excerpts.map((e, i) => `### 片段 ${i + 1}\n${e}`).join('\n\n')
      : '（本轮没有可用的会话片段）',
  ].join('\n');
}

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

/** LLM 分析结果 JSON 结构（user/soul 段分别对齐 UserProfileAnalysis / SoulAlignmentResult） */
interface UserProfileAnalysisResult {
  user?: {
    needsUpdate?: boolean;
    newPreferences?: string[];
    changedPreferences?: string[];
    suggestedPatch?: string;
    reason?: string;
    confidence?: number;
  };
  soul?: {
    needsUpdate?: boolean;
    suggestedPatch?: string;
    reason?: string;
    confidence?: number;
  };
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
   * 用模型生成人格/偏好分析 JSON（供 `analyzeSoulAlignment` /
   * `analyzeUserProfileChanges` 解析）。
   *
   * 修复（2026-11-25 第 4 批）：调用方原先把字面 `'{}'` 当分析结果传入 ⇒
   * `needsUpdate` 恒 false、SOUL/USER 永不更新（阶段 1「LLM 分析」实际从未执行）。
   *
   * 边界（CS03/CS04）：
   * - 无高价值会话片段 ⇒ 直接返回 `'{}'`（零模型调用、零成本）；
   * - 无可用 provider / 调用失败 ⇒ 返回 `'{}'`（= 不更新），只记 warn，**不伪造结论**。
   */
  async analyzeWithModel(
    input: PersonalityAnalysisInput,
    deps: PersonalityAnalysisDeps = {}
  ): Promise<string> {
    if (input.sessionExcerpts.length === 0) return '{}';

    try {
      const ai = (deps.resolveAi ?? resolveAiAccess)() as {
        getModelRouter(): unknown;
        getProviderRegistry(): unknown;
        createToolAwareClient(provider: unknown): unknown;
      };
      const router = ai.getModelRouter() as {
        resolveAsync(role: string): Promise<string | null>;
      } | null;
      const registry = ai.getProviderRegistry() as {
        getByModel(model: string): unknown;
        getDefaultProvider(): unknown;
      } | null;
      // 与 MemoryDreamService 同口径：显式经模型路由取模型，避免默认 provider 的不可控默认模型
      const model = router ? await router.resolveAsync('quick') : null;
      const provider =
        model && registry
          ? registry.getByModel(model)
          : registry?.getDefaultProvider();
      if (!provider) {
        logger.warn('人格分析：无可用 AI Provider，本轮跳过（不更新 SOUL/USER）');
        return '{}';
      }

      const client = ai.createToolAwareClient(provider) as {
        sendMessage(
          messages: unknown,
          options: unknown
        ): Promise<{ content: string }>;
      };
      const response = await client.sendMessage(
        [
          {
            role: 'user',
            content: buildPersonalityAnalysisPrompt(input),
          },
        ],
        { model, temperature: 0.2, maxTokens: 1600 }
      );
      return response.content || '{}';
    } catch (e) {
      logger.warn('人格分析调用失败，本轮跳过（不更新 SOUL/USER）', {
        error: e instanceof Error ? e.message : String(e),
      });
      return '{}';
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
  private parseAnalysisResult(result: string): UserProfileAnalysisResult {
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
