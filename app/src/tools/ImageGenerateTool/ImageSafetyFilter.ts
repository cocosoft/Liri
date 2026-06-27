/**
 * ImageSafetyFilter
 * 图像生成内容安全过滤钩子
 *
 * 在 Provider 调用前后各开放一个可配置的安全检测钩子：
 *   - beforeGenerate：生成前检测 prompt 内容
 *   - afterGenerate：生成后检测图片内容
 *
 * 默认策略：基于关键词的黑白名单过滤（最低成本）
 * 可接第三方内容审核 API（如阿里云内容安全）
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageGenerate',
});

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
   * 当前为占位实现，可接入第三方内容审核 API
   *
   * @param _imageBuffer 生成的图片 Buffer
   * @param prompt 原始 prompt
   * @returns 检测结果
   */
  async afterGenerate(
    _imageBuffer: Buffer,
    prompt: string
  ): Promise<SafetyCheckResult> {
    if (!this.config.enabled) {
      return { passed: true };
    }

    // 再次检查 prompt（作为生成后验证的快速路径）
    const promptCheck = this.beforeGenerate(prompt);
    if (!promptCheck.passed) {
      return promptCheck;
    }

    // TODO: 接入第三方内容审核 API
    // 当前为默认通过，实际部署时替换为真实检测
    return { passed: true };
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
