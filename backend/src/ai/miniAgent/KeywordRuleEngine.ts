// @ts-nocheck
/**
 * 规则引擎实现
 * 基于关键词和正则匹配的意图分类
 */

import {
  IRuleEngine,
  Intent,
  RuleMatch,
  IntentType,
  ROUTING_KEYWORDS,
  DEFAULT_ROUTING_RULES,
} from './types.js';

export class KeywordRuleEngine implements IRuleEngine {
  private rules: RuleMatch[];
  private keywords: Record<IntentType, string[]>;

  constructor(
    rules: RuleMatch[] = DEFAULT_ROUTING_RULES,
    keywords: Record<IntentType, string[]> = ROUTING_KEYWORDS
  ) {
    this.rules = rules;
    this.keywords = keywords;
  }

  classify(input: string): Intent {
    const trimmedInput = input.trim().toLowerCase();

    if (trimmedInput.length === 0) {
      return { type: 'general', confidence: 0 };
    }

    for (const rule of this.rules) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(trimmedInput) || regex.test(input)) {
        return { ...rule.intent };
      }
    }

    return this.classifyByKeywords(input);
  }

  match(input: string): RuleMatch | null {
    const trimmedInput = input.trim();

    for (const rule of this.rules) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(trimmedInput)) {
        return rule;
      }
    }

    return null;
  }

  private classifyByKeywords(input: string): Intent {
    const trimmedInput = input.toLowerCase();

    const intentScores: Record<IntentType, number> = {
      command: 0,
      code_generation: 0,
      explanation: 0,
      simple_qa: 0,
      general: 0,
    };

    for (const [intentType, keywords] of Object.entries(this.keywords)) {
      if (intentType === 'general') continue;

      for (const keyword of keywords) {
        if (trimmedInput.includes(keyword.toLowerCase())) {
          intentScores[intentType as IntentType] += 1;
        }
      }
    }

    let maxScore = 0;
    let detectedIntent: IntentType = 'general';

    for (const [intentType, score] of Object.entries(intentScores)) {
      if (score > maxScore) {
        maxScore = score;
        detectedIntent = intentType as IntentType;
      }
    }

    const confidence = maxScore > 0 ? Math.min(0.5 + maxScore * 0.15, 0.95) : 0.5;

    return {
      type: detectedIntent,
      confidence,
    };
  }

  addRule(rule: RuleMatch): void {
    this.rules.push(rule);
  }

  removeRule(pattern: string): void {
    this.rules = this.rules.filter((r) => r.pattern !== pattern);
  }

  getRules(): RuleMatch[] {
    return [...this.rules];
  }

  static createDefault(): KeywordRuleEngine {
    return new KeywordRuleEngine();
  }
}