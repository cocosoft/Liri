/**
 * ImageSafetyFilter
 * 图像生成内容安全过滤钩子
 *
 * 在 Provider 调用前后各开放一个可配置的安全检测钩子：
 *   - beforeGenerate：生成前检测 prompt 内容
 *   - afterGenerate：生成后检测图片内容
 *
 * 默认策略：基于关键词的黑白名单过滤（最低成本）
 *
 * ⚠️ 2026-10-31（用户口径「先如实标注未审核」）：**生成后**审核**尚无真实审核器**
 * ——`afterGenerate()` 只复用 prompt 关键词前置检查、不看图片，且该方法的返回值
 * 一律 `reviewed: false`（明示"未审核"）。接入第三方/模型审核见台账「功能缺口排期」P3。
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:imageGenerate');

/** 安全过滤严格度 */
export type SafetyStrictness = 'low' | 'medium' | 'high';

/** 安全过滤配置 */
export interface SafetyFilterConfig {
  enabled: boolean;
  strictness: SafetyStrictness;
}

/** 过滤结果 */
export interface SafetyCheckResult {
  passed: boolean;
  reason?: string;
  blockedKeywords?: string[];
  /**
   * 是否**真正经过**内容审核（2026-10-31，用户口径「先如实标注未审核」）。
   *
   * - `true`：由真实审核器（第三方 API / 模型判定）给出的结论；
   * - `false`：**未审核**（当前无审核能力，仅做了 prompt 关键词前置检查）；
   * - 缺省：历史调用方未区分（按"未知"处理，不得当作已审核）。
   */
  reviewed?: boolean;
}

/** 默认严格度关键词 */
const BLOCKED_KEYWORDS: Record<SafetyStrictness, string[]> = {
  low: [
    // 仅拦截明显违规内容
    'child abuse',
    'child pornography',
  ],
  medium: [
    ...['child abuse', 'child pornography'],
    'violence',
    'gore',
    'torture',
    'weapon',
    'hate speech',
    'racist',
    'discrimination',
  ],
  high: [
    ...[
      'child abuse',
      'child pornography',
      'violence',
      'gore',
      'torture',
      'weapon',
      'hate speech',
      'racist',
      'discrimination',
    ],
    'nude',
    'naked',
    'explicit',
    'porn',
    'drug',
    'suicide',
    'self-harm',
  ],
};

/** 白名单（始终允许的关键词） */
const ALLOWLIST: string[] = [
  'medical',
  'educational',
  'anatomy',
  'art',
  'historical',
  'documentary',
  'scientific',
];

export class ImageSafetyFilter {
  private config: SafetyFilterConfig;

  constructor(config?: Partial<SafetyFilterConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      strictness: config?.strictness ?? 'medium',
    };
  }

  /** 更新配置 */
  updateConfig(config: Partial<SafetyFilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 获取当前配置 */
  getConfig(): SafetyFilterConfig {
    return { ...this.config };
  }

  /**
   * 生成前安全检查（检测 prompt 内容）
   * @param prompt 用户输入的 prompt
   * @returns 检测结果
   */
  beforeGenerate(prompt: string): SafetyCheckResult {
    if (!this.config.enabled) {
      return { passed: true };
    }

    const lowerPrompt = prompt.toLowerCase();

    // 检查白名单
    const hasAllowlist = ALLOWLIST.some((kw) => lowerPrompt.includes(kw));
    if (hasAllowlist) {
      return { passed: true };
    }

    // 检查黑名单
    const keywords = BLOCKED_KEYWORDS[this.config.strictness];
    const blocked = keywords.filter((kw) => lowerPrompt.includes(kw));

    if (blocked.length > 0) {
      logger.warn('ImageSafetyFilter · 生成前检测拦截', {
        strictness: this.config.strictness,
        blockedKeywords: blocked,
        prompt: prompt.slice(0, 100),
      });

      return {
        passed: false,
        reason: `Prompt contains blocked content (strictness: ${this.config.strictness})`,
        blockedKeywords: blocked,
      };
    }

    return { passed: true };
  }

  /**
   * 生成后安全检查（检测生成的图片内容）
   *
   * ⚠️ 2026-10-31（用户口径「先如实标注未审核」）：本方法目前**没有任何真实审核能力**
   * ——它只复用 `beforeGenerate()` 的 prompt 关键词前置检查，**不看图片内容**。
   * 因此返回值一律带 `reviewed: false` + 明确 `reason`（"未审核"），
   * 不再让调用方把"没查到违规"误读成"图片已通过审核"。
   *
   * 另注（如实）：本方法当前**零生产调用方**（`grep afterGenerate(` 仅命中定义），
   * 即"生成后审核"整体**未接线**；接线与真实审核器见台账「功能缺口排期」P3。
   *
   * @param _imageBuffer 生成的图片 Buffer（当前未使用 —— 无审核能力）
   * @param prompt 原始 prompt
   * @returns 检测结果（`reviewed` 恒为 false）
   */
  async afterGenerate(
    _imageBuffer: Buffer,
    prompt: string
  ): Promise<SafetyCheckResult> {
    if (!this.config.enabled) {
      return {
        passed: true,
        reviewed: false,
        reason: '内容安全过滤已禁用：生成后未审核',
      };
    }

    // 再次检查 prompt（作为生成后验证的快速路径）
    const promptCheck = this.beforeGenerate(prompt);
    if (!promptCheck.passed) {
      return { ...promptCheck, reviewed: false };
    }

    return {
      passed: true,
      reviewed: false,
      reason: '未配置内容审核能力：仅完成 prompt 前置检查，生成后图片未审核',
    };
  }
}

/** 全局单例 */
let globalFilter: ImageSafetyFilter | null = null;

export function getImageSafetyFilter(): ImageSafetyFilter {
  if (!globalFilter) {
    globalFilter = new ImageSafetyFilter();
  }
  return globalFilter;
}
