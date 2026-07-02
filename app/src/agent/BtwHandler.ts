/**
 * BtwHandler — "顺便问"侧问处理器
 *
 * 对标 OpenClaw agents/btw.ts 的侧问机制：
 * 在 Agent 正在执行主任务时，用户插入一个突发侧问，
 * BtwHandler 创建一个独立的、轻量的 LLM 调用来回答该问题，
 * 不中断主任务的执行流程。
 *
 * OpenClaw 的模式：
 * - buildBtwSystemPrompt(): 专用系统提示，声明不继续主任务
 * - buildBtwQuestionPrompt(): 侧问包装 + 主任务上下文标记
 * - stripToolResultDetails(): 上下文脱敏
 *
 * Liri 的 BtwHandler 将侧问作为一个独立会话处理，
 * 主任务上下文仅作为背景信息传入，不影响侧问的独立性。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type { ChatMessage } from '@modules/ai';
import type { AIProvider } from '@modules/ai';

const logger = new Logger({ module: 'agent:btwHandler', level: LogLevel.INFO });

/**
 * BtwHandler 配置
 */
export interface BtwHandlerConfig {
  model?: string;
  maxContextMessages?: number;
}

const DEFAULT_CONFIG: BtwHandlerConfig = {
  maxContextMessages: 20,
};

/**
 * BtwHandler — 侧问处理
 *
 * @example
 * ```typescript
 * const handler = new BtwHandler(aiProvider);
 * const answer = await handler.handleSideQuestion(
 *   '如何优化这个查询？',
 *   currentConversationMessages
 * );
 * ```
 */
export class BtwHandler {
  private provider: AIProvider;
  private config: Required<BtwHandlerConfig>;

  constructor(provider: AIProvider, config: BtwHandlerConfig = {}) {
    this.provider = provider;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      model: config.model ?? 'haiku',
      maxContextMessages:
        config.maxContextMessages ?? DEFAULT_CONFIG.maxContextMessages!,
    };
  }

  /**
   * 构建侧问系统提示
   */
  private buildSystemPrompt(): string {
    return [
      '你正在回答当前对话中的一个"顺便问"问题。',
      '仅将当前对话作为背景上下文参考。',
      '只回答用户最近提出的侧问问题。',
      '不要继续、恢复或完成对话中任何未完成的任务。',
      '不要生成工具调用、代码修改或 shell 命令，除非侧问明确要求。',
      '回答完毕即止，不要表示将继续主任务。',
      '如果问题可以简短回答，请简短回答。',
    ].join('\n');
  }

  /**
   * 构建侧问提示
   */
  private buildQuestionPrompt(question: string): string {
    return [
      '请仅回答以下侧问问题：',
      '',
      '<btw_side_question>',
      question.trim(),
      '</btw_side_question>',
    ].join('\n');
  }

  /**
   * 脱敏工具结果详情
   */
  private stripToolResults(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return { ...msg, content: '[工具执行结果已省略]' };
      }
      return msg;
    });
  }

  /**
   * 处理侧问
   *
   * @param question 用户的侧问内容
   * @param context 当前对话上下文
   * @returns 侧问的回答
   */
  async handleSideQuestion(
    question: string,
    context: ChatMessage[]
  ): Promise<string> {
    // 限制上下文大小
    const recentContext = context.slice(-this.config.maxContextMessages);
    const sanitizedContext = this.stripToolResults(recentContext);

    const messages: ChatMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      ...sanitizedContext,
      { role: 'user', content: this.buildQuestionPrompt(question) },
    ];

    try {
      const response = await this.provider.chat(messages, {
        model: this.config.model,
      });

      logger.info('侧问处理完成', {
        questionLength: question.length,
        contextSize: sanitizedContext.length,
      });

      return response.content ?? '';
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error('侧问处理失败', {
        error: errorMessage,
        question: question.slice(0, 100),
      });

      return `处理侧问时出错：${errorMessage}`;
    }
  }
}
