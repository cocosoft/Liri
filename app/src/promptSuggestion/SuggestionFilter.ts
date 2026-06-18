/**
 * Prompt Suggestion过滤规则模块
 */

import type { PromptVariant, SuggestionSource } from './types';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring/logs/Logger';

const logger = getLogger('SuggestionFilter');

interface Analytics {
  logSuggestionSuppressed: (
    reason: string,
    suggestion?: string,
    promptId?: PromptVariant,
    source?: SuggestionSource
  ) => void;
}

let analytics: Analytics | null = null;

function getAnalytics(): Analytics {
  if (!analytics) {
    analytics = {
      logSuggestionSuppressed: (
        reason: string,
        suggestion?: string,
        promptId?: PromptVariant,
        source?: SuggestionSource
      ) => {
        if (configManager.env('DEBUG_PROMPT_SUGGESTION') === 'true') {
          logger.debug('建议被过滤', { reason, suggestion, promptId, source });
        }
      },
    };
  }
  return analytics;
}

/**
 * 单字命令白名单
 * 这些单字命令是有效的用户输入
 */
const ALLOWED_SINGLE_WORDS = new Set([
  'yes',
  'yeah',
  'yep',
  'yea',
  'yup',
  'sure',
  'ok',
  'okay',
  'push',
  'commit',
  'deploy',
  'stop',
  'continue',
  'check',
  'exit',
  'quit',
  'no',
]);

/**
 * 检查建议是否应该被过滤
 * 返回true表示建议应该被过滤掉
 */
export function shouldFilterSuggestion(
  suggestion: string | null,
  promptId: PromptVariant,
  source?: SuggestionSource
): boolean {
  if (!suggestion) {
    getAnalytics().logSuggestionSuppressed(
      'empty',
      undefined,
      promptId,
      source
    );
    return true;
  }

  const lower = suggestion.toLowerCase();
  const wordCount = suggestion.trim().split(/\s+/).length;

  const filters: Array<[string, () => boolean]> = [
    ['done', () => lower === 'done'],
    [
      'meta_text',
      () =>
        lower === 'nothing found' ||
        lower === 'nothing found.' ||
        lower.startsWith('nothing to suggest') ||
        lower.startsWith('no suggestion') ||
        /\bsilence is\b|\bstay(s|ing)? silent\b/.test(lower) ||
        /^\W*silence\W*$/.test(lower),
    ],
    ['meta_wrapped', () => /^\(.*\)$|^\[.*\]$/.test(suggestion)],
    [
      'error_message',
      () =>
        lower.startsWith('api error:') ||
        lower.startsWith('prompt is too long') ||
        lower.startsWith('request timed out') ||
        lower.startsWith('invalid api key') ||
        lower.startsWith('image was too large'),
    ],
    ['prefixed_label', () => /^\w+:\s/.test(suggestion)],
    [
      'too_few_words',
      () => {
        if (wordCount >= 2) {
          return false;
        }

        if (suggestion.startsWith('/')) {
          return false;
        }

        return !ALLOWED_SINGLE_WORDS.has(lower);
      },
    ],
    ['too_many_words', () => wordCount > 12],
    ['too_long', () => suggestion.length >= 100],
    ['multiple_sentences', () => /[.!?]\s+[A-Z]/.test(suggestion)],
    ['has_formatting', () => /[\n*]|\*\*/.test(suggestion)],
    [
      'evaluative',
      () =>
        /thanks|thank you|looks good|sounds good|that works|that worked|that's all|nice|great|perfect|makes sense|awesome|excellent/.test(
          lower
        ),
    ],
    [
      'pyapp_voice',
      () =>
        /^(let me|i'll|i've|i'm|i can|i would|i think|i notice|here's|here is|here are|that's|this is|this will|you can|you should|you could|sure,|of course|certainly)/i.test(
          suggestion
        ),
    ],
  ];

  for (const [reason, check] of filters) {
    if (check()) {
      getAnalytics().logSuggestionSuppressed(
        reason,
        suggestion,
        promptId,
        source
      );
      return true;
    }
  }

  return false;
}

/**
 * 获取过滤规则的描述
 */
export function getFilterRuleDescriptions(): Array<{
  rule: string;
  description: string;
}> {
  return [
    { rule: 'done', description: '过滤"done"' },
    { rule: 'meta_text', description: '过滤元文本如"nothing found"' },
    { rule: 'meta_wrapped', description: '过滤括号包裹的文本如"(silence)"' },
    { rule: 'error_message', description: '过滤错误信息如"api error:"' },
    {
      rule: 'prefixed_label',
      description: '过滤带标签前缀的文本如"Label: text"',
    },
    { rule: 'too_few_words', description: '过滤过短的无效输入' },
    { rule: 'too_many_words', description: '过滤超过12个词的输入' },
    { rule: 'too_long', description: '过滤超过100字符的输入' },
    { rule: 'multiple_sentences', description: '过滤多个句子的输入' },
    { rule: 'has_formatting', description: '过滤包含格式字符的输入' },
    { rule: 'evaluative', description: '过滤评价性文本如"thanks"' },
    { rule: 'pyapp_voice', description: '过滤AI语气文本如"Let me..."' },
  ];
}

/**
 * 检查建议是否为有效的单字命令
 */
export function isAllowedSingleWord(word: string): boolean {
  return ALLOWED_SINGLE_WORDS.has(word.toLowerCase());
}

/**
 * 检查建议是否包含AI语气
 */
export function hasPyAppVoice(suggestion: string): boolean {
  const lower = suggestion.toLowerCase();
  return /^(let me|i'll|i've|i'm|i can|i would|i think|i notice|here's|here is|here are|that's|this is|this will|you can|you should|you could|sure,|of course|certainly)/i.test(
    lower
  );
}

/**
 * 检查建议是否为评价性文本
 */
export function isEvaluative(suggestion: string): boolean {
  const lower = suggestion.toLowerCase();
  return /thanks|thank you|looks good|sounds good|that works|that worked|that's all|nice|great|perfect|makes sense|awesome|excellent/.test(
    lower
  );
}

/**
 * 设置分析器
 */
export function setFilterAnalytics(analyticsInstance: Analytics): void {
  analytics = analyticsInstance;
}
