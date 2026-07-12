/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 翻译后处理器
 *
 * 4 策略管道，按序执行，任一命中即停止后续策略。
 */

import type { PostProcessResult } from './types';

type PostProcessStrategy = (
  text: string,
  sourceText: string
) => { modified: boolean; result: string };

export class PostProcessor {
  private strategies: Array<{ name: string; fn: PostProcessStrategy }>;

  constructor() {
    this.strategies = [
      { name: 'removeCommonPrefix', fn: this.removeCommonPrefix },
      { name: 'removeSourceEcho', fn: this.removeSourceEcho },
      { name: 'detectNonTranslation', fn: this.detectNonTranslation },
      { name: 'extractQuotedContent', fn: this.extractQuotedContent },
    ];
  }

  /**
   * 执行后处理管道
   */
  process(rawOutput: string, sourceText: string): PostProcessResult {
    const trimmed = rawOutput.trim();
    if (!trimmed) {
      return {
        cleaned: trimmed,
        appliedStrategies: [],
        isNonTranslation: false,
      };
    }

    const appliedStrategies: string[] = [];
    let current = trimmed;

    for (const { name, fn } of this.strategies) {
      const { modified, result } = fn(current, sourceText);
      if (modified && result !== current) {
        current = result;
        appliedStrategies.push(name);
      }
    }

    const isNonTranslation = appliedStrategies.includes('detectNonTranslation');

    return { cleaned: current.trim(), appliedStrategies, isNonTranslation };
  }

  /**
   * 策略 1：移除常见前缀
   */
  private removeCommonPrefix: PostProcessStrategy = (text, _sourceText) => {
    const prefixPatterns = [
      /^Translation:\s*/i,
      /^翻译[：:]\s*/,
      /^译文[：:]\s*/,
      /^Translated text:\s*/i,
      /^翻译结果[：:]\s*/,
      /^Here is the translation:\s*/i,
      /^以下是翻译[：:]\s*/,
    ];

    for (const pattern of prefixPatterns) {
      const match = text.match(pattern);
      if (match) {
        return { modified: true, result: text.slice(match[0].length) };
      }
    }
    return { modified: false, result: text };
  };

  /**
   * 策略 2：移除原文回显
   */
  private removeSourceEcho: PostProcessStrategy = (text, sourceText) => {
    const trimmed = text.trim();
    const trimmedSource = sourceText.trim();

    if (trimmedSource.length > 0 && trimmed.startsWith(trimmedSource)) {
      const remaining = trimmed.slice(trimmedSource.length).trim();
      if (remaining.length > 0) {
        return { modified: true, result: remaining };
      }
    }
    return { modified: false, result: text };
  };

  /**
   * 策略 3：检测非翻译（模型拒绝翻译）
   */
  private detectNonTranslation: PostProcessStrategy = (text, _sourceText) => {
    const refusalPatterns = [
      /I cannot translate/i,
      /I can't translate/i,
      /我无法翻译/,
      /我不能翻译/,
      /Sorry, I can['']t/i,
      /I am not able to translate/i,
      /As an AI/i,
      /I don't feel comfortable/i,
    ];

    for (const pattern of refusalPatterns) {
      if (pattern.test(text)) {
        return { modified: true, result: text };
      }
    }
    return { modified: false, result: text };
  };

  /**
   * 策略 4：提取引号内容
   */
  private extractQuotedContent: PostProcessStrategy = (text, _sourceText) => {
    const trimmed = text.trim();

    // 双引号包裹
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner.length > 0) {
        return { modified: true, result: inner };
      }
    }

    // 单引号包裹
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner.length > 0) {
        return { modified: true, result: inner };
      }
    }

    // 中文引号包裹
    if (trimmed.startsWith('\u201C') && trimmed.endsWith('\u201D')) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner.length > 0) {
        return { modified: true, result: inner };
      }
    }

    return { modified: false, result: text };
  };
}
