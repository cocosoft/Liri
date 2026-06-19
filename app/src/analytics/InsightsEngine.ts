/**
 * 洞察引擎
 * 对标 Hermes agent/insights.py（InsightsEngine）
 *
 * 从对话历史中自动提取关键信息和元数据，无需 LLM 调用。
 * 采用纯规则匹配模式，轻量级、可嵌入任何 Agent 循环。
 */
import { getLogger } from '@modules/monitoring';

const logger = getLogger('InsightsEngine');

/**
 * 对话消息格式
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp?: number;
}

/**
 * 洞察提取结果
 * 对标 Hermes InsightsEngine 输出结构
 */
export interface InsightsResult {
  /** 关键事实列表 */
  keyFacts: string[];
  /** 做出的决策列表 */
  decisions: string[];
  /** 待处理问题列表 */
  pendingQuestions: string[];
  /** 涉及的文件变更列表 */
  fileChanges: string[];
  /** 对话摘要 */
  summary: string;
  /** 提取时间 */
  extractedAt: number;
}

/**
 * 洞察引擎配置
 */
export interface InsightsEngineConfig {
  /** 提取关键事实的正则模式 */
  factPatterns?: RegExp[];
  /** 提取决策的正则模式 */
  decisionPatterns?: RegExp[];
  /** 文件变更模式 */
  fileChangePatterns?: RegExp[];
  /** 摘要最大长度 */
  maxSummaryLength?: number;
}

const DEFAULT_FACT_PATTERNS: RegExp[] = [
  /确认[：:]\s*(.+)/g,
  /发现[：:]\s*(.+)/g,
  /定位[：:]\s*(.+)/g,
  /错误原因[：:]\s*(.+)/g,
  /根本原因[：:]\s*(.+)/g,
  /结论[：:]\s*(.+)/g,
];

const DEFAULT_DECISION_PATTERNS: RegExp[] = [
  /决定[：:]\s*(.+)/g,
  /采用[：:]\s*(.+)/g,
  /选择[：:]\s*(.+)/g,
  /使用\s*(\S+)\s*(?:方案|方法|方式|模式)/g,
  /迁移[：:到]\s*(.+)/g,
  /替换[：:为]\s*(.+)/g,
];

const DEFAULT_FILE_CHANGE_PATTERNS: RegExp[] = [
  /(?:修改|编辑|更新|创建|新增|删除|移除|重命名|移动|拷贝)\s+`?([^\s`，,。]+)`?/g,
  /file\s+(?:write|edit|read|delete|create)\s+["']?([^\s"']+)["']?/gi,
  /(?:修改|编辑|创建|删除)了?\s*["']?([^\s"'，,。]+\.\w+)["']?/g,
];

/**
 * 洞察引擎
 * 从对话消息列表中提取结构化的关键信息
 */
export class InsightsEngine {
  private config: InsightsEngineConfig;

  constructor(config: InsightsEngineConfig = {}) {
    this.config = config;
  }

  /**
   * 从消息列表中提取洞察
   * @param messages 对话历史消息
   * @returns 结构化的洞察结果
   */
  extract(messages: ConversationMessage[]): InsightsResult {
    const allText = this.concatMessages(messages);
    const assistantOnly = this.concatMessages(
      messages.filter((m) => m.role === 'assistant')
    );

    const factPatterns = this.config.factPatterns ?? DEFAULT_FACT_PATTERNS;
    const decisionPatterns =
      this.config.decisionPatterns ?? DEFAULT_DECISION_PATTERNS;
    const fileChangePatterns =
      this.config.fileChangePatterns ?? DEFAULT_FILE_CHANGE_PATTERNS;

    return {
      keyFacts: this.extractWithPatterns(allText, factPatterns),
      decisions: this.extractWithPatterns(assistantOnly, decisionPatterns),
      pendingQuestions: this.extractPendingQuestions(allText),
      fileChanges: this.extractWithPatterns(allText, fileChangePatterns),
      summary: this.generateSummary(allText),
      extractedAt: Date.now(),
    };
  }

  /**
   * 提取待处理问题
   * 匹配问句模式
   */
  private extractPendingQuestions(text: string): string[] {
    const patterns = [
      /[需要还需还应].*?[？?]/g,
      /下一步.*?[？?]/g,
      /是否.*?[？?]/g,
      /(?:what|how|where|when|why)\s+\w+.*?\?/gi,
    ];

    const resultSet = new Set<string>();
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const q = match[0].trim();
        if (q.length > 3) {
          resultSet.add(q);
        }
      }
    }

    return Array.from(resultSet).slice(0, 10);
  }

  /**
   * 使用多个正则提取匹配内容
   * 去重并清理结果
   */
  private extractWithPatterns(text: string, patterns: RegExp[]): string[] {
    const resultSet = new Set<string>();

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const captured = match[1] || match[0];
        const cleaned = captured.trim();
        if (cleaned.length > 1 && cleaned.length < 200) {
          resultSet.add(cleaned);
        }
      }
    }

    return Array.from(resultSet).slice(0, 20);
  }

  /**
   * 生成对话摘要
   * 取首尾关键句，标注中间省略
   */
  private generateSummary(text: string): string {
    const maxLen = this.config.maxSummaryLength ?? 500;
    const sentences = text
      .split(/[。！？\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);

    if (sentences.length === 0) {
      return text.slice(0, maxLen);
    }

    if (sentences.length <= 3) {
      const result = sentences.join('；');
      return result.length <= maxLen
        ? result
        : result.slice(0, maxLen - 3) + '...';
    }

    const first = sentences[0];
    const last = sentences[sentences.length - 1];
    const omitted = sentences.length - 2;

    const summary = `${first}…[${omitted} 句省略]…${last}`;
    return summary.length <= maxLen
      ? summary
      : summary.slice(0, maxLen - 3) + '...';
  }

  /**
   * 连接消息文本
   */
  private concatMessages(messages: ConversationMessage[]): string {
    return messages
      .map((m) => m.content)
      .filter(Boolean)
      .join('\n');
  }
}

export const insightsEngine = new InsightsEngine();
