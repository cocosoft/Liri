/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 翻译提示词构建器
 *
 * 支持术语表注入和 few-shot 示例注入。
 */

import type { LanguageCode, TranslateHistoryRecord } from './types';

/** 语言代码 → 各语言名称映射 */
const LANG_NAME: Record<string, Record<string, string>> = {
  zh: {
    zh: '简体中文',
    en: 'Simplified Chinese',
    ja: '簡体字中国語',
    ko: '중국어 간체',
  },
  'zh-TW': {
    zh: '繁体中文',
    en: 'Traditional Chinese',
    ja: '繁体字中国語',
    ko: '중국어 번체',
  },
  en: { zh: 'English', en: 'English', ja: '英語', ko: '영어' },
  ja: { zh: '日本語', en: 'Japanese', ja: '日本語', ko: '일본어' },
  ko: { zh: '한국어', en: 'Korean', ja: '韓国語', ko: '한국어' },
  fr: { zh: 'Français', en: 'French', ja: 'フランス語', ko: '프랑스어' },
  de: { zh: 'Deutsch', en: 'German', ja: 'ドイツ語', ko: '독일어' },
  es: { zh: 'Español', en: 'Spanish', ja: 'スペイン語', ko: '스페인어' },
  pt: {
    zh: 'Português',
    en: 'Portuguese',
    ja: 'ポルトガル語',
    ko: '포르투갈어',
  },
  ru: { zh: 'Русский', en: 'Russian', ja: 'ロシア語', ko: '러시아어' },
  ar: { zh: 'العربية', en: 'Arabic', ja: 'アラビア語', ko: '아랍어' },
  th: { zh: 'ไทย', en: 'Thai', ja: 'タイ語', ko: '태국어' },
  vi: { zh: 'Tiếng Việt', en: 'Vietnamese', ja: 'ベトナム語', ko: '베트남어' },
};

export class PromptBuilder {
  /**
   * 构建翻译 system prompt
   *
   * @param sourceLang 源语言代码
   * @param targetLang 目标语言代码
   * @param glossaryPrompt 术语表注入文本（可选，由 GlossaryManager 生成）
   */
  buildSystemPrompt(
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    glossaryPrompt?: string
  ): string {
    const srcName = LANG_NAME[sourceLang]?.['zh'] || sourceLang;
    const tgtName = LANG_NAME[targetLang]?.['zh'] || targetLang;

    const parts = [
      `You are a professional translator. Translate the following text from ${srcName} to ${tgtName}.`,
      '',
      'Rules:',
      '1. Only output the translated text, nothing else',
      '2. Preserve the original formatting, line breaks, and punctuation style',
      '3. Do NOT add explanations, notes, or commentary',
      `4. If the text is already in ${tgtName}, return it as-is`,
      '5. Keep proper nouns, brand names, and technical terms in their original form unless a well-established translation exists',
    ];

    // 注入术语表约束
    if (glossaryPrompt) {
      parts.push(glossaryPrompt);
    }

    return parts.join('\n');
  }

  /**
   * 从历史记录中选取同语言对的优质翻译作为 few-shot 示例
   *
   * 选取策略：与当前语言对匹配的最近历史记录，最多 maxExamples 条。
   * 后续可扩展为基于翻译质量评分的采样。
   *
   * @param sourceLang 源语言
   * @param targetLang 目标语言
   * @param history 翻译历史记录
   * @param maxExamples 最大示例数，默认 3
   */
  buildFewShotExamples(
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    history: TranslateHistoryRecord[],
    maxExamples = 3
  ): string {
    const matched = history.filter(
      (r) =>
        r.sourceLang === sourceLang &&
        r.targetLang === targetLang &&
        r.sourceText.length > 3 // 过滤太短的
    );

    if (matched.length === 0) return '';

    const examples = matched.slice(0, maxExamples);

    const lines: string[] = [
      '',
      'Here are some translation examples for reference:',
    ];

    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      lines.push(`Example ${i + 1}:`);
      lines.push(`  Source: ${ex.sourceText.substring(0, 200)}`);
      lines.push(`  Target: ${ex.translatedText.substring(0, 200)}`);
    }

    return lines.join('\n');
  }

  /**
   * 构建翻译 user message
   */
  buildUserMessage(text: string): string {
    return text;
  }

  /**
   * 构建完整的 messages 数组（system + few-shot + user）
   *
   * @param sourceLang 源语言
   * @param targetLang 目标语言
   * @param text 待翻译文本
   * @param options 可选参数
   */
  buildMessages(
    sourceLang: LanguageCode,
    targetLang: LanguageCode,
    text: string,
    options?: {
      glossaryPrompt?: string;
      fewShotHistory?: TranslateHistoryRecord[];
      maxFewShot?: number;
    }
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

    // system prompt（含术语表）
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(
        sourceLang,
        targetLang,
        options?.glossaryPrompt
      ),
    });

    // few-shot 示例（注入到 user message 之前）
    if (options?.fewShotHistory?.length) {
      const fewShotText = this.buildFewShotExamples(
        sourceLang,
        targetLang,
        options.fewShotHistory,
        options.maxFewShot
      );

      if (fewShotText) {
        // 将 few-shot 追加到 user message 中
        messages.push({
          role: 'user',
          content: `${fewShotText}\n\nNow translate this:\n\n${text}`,
        });
        return messages;
      }
    }

    messages.push({
      role: 'user',
      content: this.buildUserMessage(text),
    });

    return messages;
  }
}
