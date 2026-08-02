/**
 * 隐性引擎钩子
 *
 * 规则驱动的 post-process：分析 AI/用户消息文本，检测 Plan/Do/Check/Act 意图，
 * 自动写入 rules.md（Plan 类）或 artifacts（Do 类）。
 *
 * 触发策略：仅对"有产出意图"的消息触发（规则匹配命中），普通闲聊跳过。
 */

import type { ProjectContextType } from '@modules/workspace/types';

/** 意图分类 */
export type ImplicitIntent = 'plan' | 'do' | 'check' | 'act' | 'none';

/** 规则匹配结果 */
export interface IntentMatch {
  intent: ImplicitIntent;
  /** 提取出的上下文类型 */
  contextType?: ProjectContextType;
  /** 提取出的内容 */
  content: string;
  /** 置信度 0-1 */
  confidence: number;
}

// ──── Plan 检测规则 ────
const PLAN_PATTERNS: Array<{ regex: RegExp; type: ProjectContextType }> = [
  { regex: /目标[是为：:]\s*(.+)/, type: 'goal' },
  { regex: /项目目标[是为：:]\s*(.+)/, type: 'goal' },
  { regex: /核心目标[是为：:]\s*(.+)/, type: 'goal' },
  { regex: /范围[是为：:]\s*(.+)/, type: 'scope' },
  { regex: /不[包括含做]|只做|仅限[于]?(\S+)/, type: 'scope' },
  { regex: /约束[是为：:]\s*(.+)/, type: 'constraint' },
  { regex: /限制[是为：:]\s*(.+)/, type: 'constraint' },
  { regex: /需求[是为：:]\s*(.+)/, type: 'requirement' },
  { regex: /知识[是为：:]\s*(.+)/, type: 'knowledge' },
];

// ──── Do 检测规则 ────
const DO_PATTERNS = [
  /生成[了]?\s*(.+)/,
  /创建[了]?\s*(.+)/,
  /产出[了：:]\s*(.+)/,
  /交付[了：:]\s*(.+)/,
  /完成[了：:]\s*(.+)/,
  /已[经]?\s*实现[了：:]\s*(.+)/,
];

// ──── Check 检测规则 ────
const CHECK_PATTERNS = [
  /检查|验证|对照|审核|比对|核实/,
];

// ──── Act 检测规则 ────
const ACT_PATTERNS = [
  /调整|修改|改进|优化|纠正|修复/,
];

export class ImplicitEngineHook {
  /**
   * 分析消息文本，检测意图并提取内容
   */
  static analyze(text: string): IntentMatch[] {
    const matches: IntentMatch[] = [];

    // Plan 检测
    for (const { regex, type } of PLAN_PATTERNS) {
      const m = text.match(regex);
      if (m?.[1]) {
        const content = m[1].trim().slice(0, 200);
        if (content.length >= 2) {
          matches.push({ intent: 'plan', contextType: type, content, confidence: 0.7 });
        }
      }
    }

    // Do 检测
    for (const pattern of DO_PATTERNS) {
      const m = text.match(pattern);
      if (m?.[1]) {
        const content = m[1].trim().slice(0, 200);
        if (content.length >= 3) {
          matches.push({ intent: 'do', content, confidence: 0.6 });
        }
        break; // 只取第一个匹配
      }
    }

    // Check 检测
    for (const pattern of CHECK_PATTERNS) {
      if (pattern.test(text)) {
        matches.push({ intent: 'check', content: text.slice(0, 100), confidence: 0.5 });
        break;
      }
    }

    // Act 检测
    for (const pattern of ACT_PATTERNS) {
      if (pattern.test(text)) {
        matches.push({ intent: 'act', content: text.slice(0, 100), confidence: 0.4 });
        break;
      }
    }

    return matches;
  }

  /**
   * 判断是否有产出意图（非闲聊）
   */
  static hasIntent(text: string): boolean {
    return this.analyze(text).length > 0;
  }

  /**
   * 处理消息：分析意图并返回需要写入的数据
   * 由调用方负责 HTTP 写入（避免模块耦合 HTTP）
   */
  static process(text: string): {
    contexts: Array<{ type: ProjectContextType; content: string }>;
    deliverables: string[];
  } {
    const matches = this.analyze(text);
    const contexts: Array<{ type: ProjectContextType; content: string }> = [];
    const deliverables: string[] = [];

    for (const match of matches) {
      if (match.intent === 'plan' && match.contextType) {
        contexts.push({ type: match.contextType, content: match.content });
      }
      if (match.intent === 'do') {
        deliverables.push(match.content);
      }
    }

    return { contexts, deliverables };
  }
}
