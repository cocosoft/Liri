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
 * BTW (Back That Way) 侧问题回答系统
 * 对标 OpenClaw agents/btw.ts
 *
 * 在 Agent 正在执行主任务时，允许用户插入一个"顺便问一下"的侧问题，
 * 系统会独立回答该问题而不干扰主任务的进行。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ module: 'agent:btw:index', level: LogLevel.INFO });

/**
 * BTW 侧问题的检测结果
 */
export interface BtwDetectionResult {
  /** 是否检测到 BTW 侧问题 */
  isBtw: boolean;
  /** 从用户消息中提取出的侧问题文本 */
  question: string;
  /** 原始消息中移除侧问题后剩余的主任务内容 */
  mainTaskContent: string;
}

/**
 * BTW 侧问题的回答结果
 */
export interface BtwAnswerResult {
  /** 侧问题的回答文本 */
  answer: string;
  /** 回答耗时（毫秒） */
  durationMs: number;
  /** 使用的模型 */
  model: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * BTW 处理器配置
 */
export interface BtwProcessorConfig {
  /** 用于回答侧问题的模型标识 */
  model: string;
  /** Provider 名称 */
  provider: string;
  /** 最大上下文消息数（用于提供背景） */
  maxContextMessages: number;
  /** 回答超时时间（毫秒） */
  timeoutMs: number;
  /** 是否启用 BTW 功能 */
  enabled: boolean;
}

/**
 * 消息条目，用于构建上下文
 */
export interface BtwContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const DEFAULT_CONFIG: BtwProcessorConfig = {
  model: '',
  provider: '',   // 空 → 从 DB/环境变量自动检测
  maxContextMessages: 10,
  timeoutMs: 30000,
  enabled: true,
};

/**
 * BTW 模式匹配的正则列表
 * 匹配各种"顺便问一下"的表达方式
 */
const BTW_PATTERNS: RegExp[] = [
  /^(?:btw|by the way|顺便|另外|对了|话说|突然想到)[，,:\s]*(.+)/i,
  /(?:btw|by the way|顺便问一下|顺便提一下|另外想问)[，,:\s]*(.+)/i,
];

/**
 * BTWProcessor
 * 负责检测和回答侧问题，确保不干扰主任务的执行
 */
export class BtwProcessor {
  private config: BtwProcessorConfig;

  constructor(config?: Partial<BtwProcessorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<BtwProcessorConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info(`BTWProcessor config updated, enabled: ${this.config.enabled}`);
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<BtwProcessorConfig> {
    return { ...this.config };
  }

  /**
   * 检测用户消息是否包含 BTW 侧问题
   * 如果检测到，返回提取出的问题内容和剩余的主任务内容
   */
  detectBtwQuestion(userMessage: string): BtwDetectionResult {
    if (!this.config.enabled || !userMessage) {
      return {
        isBtw: false,
        question: '',
        mainTaskContent: userMessage,
      };
    }

    // 尝试每种 BTW 模式
    for (const pattern of BTW_PATTERNS) {
      const match = userMessage.match(pattern);
      if (match) {
        const question = match[1].trim();
        if (question) {
          // 从原消息中移除 BTW 部分
          const mainTaskContent = userMessage.replace(match[0], '').trim();

          logger.info(`BTW question detected: "${question.slice(0, 80)}..."`);
          return {
            isBtw: true,
            question,
            mainTaskContent,
          };
        }
      }
    }

    return {
      isBtw: false,
      question: '',
      mainTaskContent: userMessage,
    };
  }

  /**
   * 构建用于回答侧问题的系统提示
   * 强调只回答侧问题，不要继续主任务
   */
  buildSystemPrompt(): string {
    return [
      'You are answering an ephemeral side question about the current conversation.',
      'Use the conversation only as background context.',
      'Answer only the side question in the most recent user message.',
      'Do not continue, resume, or complete any unfinished task from the conversation.',
      'Do not emit tool calls, pseudo-tool calls, shell commands, file writes, patches, or code unless the side question explicitly asks for them.',
      'Do not say you will continue the main task after answering.',
      'If the question can be answered briefly, answer briefly.',
    ].join('\n');
  }

  /**
   * 构建侧问题的提示词
   */
  buildQuestionPrompt(question: string, mainTaskContext?: string): string {
    const lines: string[] = [
      'Answer this side question only.',
      'Ignore any unfinished task in the conversation while answering it.',
    ];

    const trimmedContext = mainTaskContext?.trim();
    if (trimmedContext) {
      lines.push(
        '',
        'Current main task context (for background reference only):',
        '<main_task_context>',
        trimmedContext,
        '</main_task_context>',
        'Do not continue or complete that task while answering the side question.'
      );
    }

    lines.push(
      '',
      '<btw_side_question>',
      question.trim(),
      '</btw_side_question>'
    );
    return lines.join('\n');
  }

  /**
   * 从上下文中提取最近的消息作为背景信息
   */
  extractContext(
    messages: BtwContextMessage[],
    maxMessages?: number
  ): BtwContextMessage[] {
    const limit = maxMessages ?? this.config.maxContextMessages;
    if (messages.length <= limit) {
      return [...messages];
    }
    // 保留最近的消息，但始终包含第一条 system 消息
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    const recentNonSystem = nonSystemMessages.slice(
      -(limit - systemMessages.length)
    );
    return [...systemMessages, ...recentNonSystem];
  }

  /**
   * 处理侧问题回答
   * 这是核心方法：构建专用上下文，调用模型回答侧问题
   *
   * 注意：实际 AI 调用需要注入外部 AI Service 实例
   * 这里提供标准接口，由上层调用者传入 AI Service
   */
  async processBtw(params: {
    question: string;
    contextMessages?: BtwContextMessage[];
    mainTaskContext?: string;
    aiCall: (messages: BtwContextMessage[]) => Promise<string>;
  }): Promise<BtwAnswerResult> {
    const startTime = Date.now();
    const { question, contextMessages, mainTaskContext, aiCall } = params;

    try {
      // 构建系统提示
      const systemPrompt = this.buildSystemPrompt();

      // 构建问题提示
      const questionPrompt = this.buildQuestionPrompt(
        question,
        mainTaskContext
      );

      // 构建上下文消息
      const btwMessages: BtwContextMessage[] = [
        { role: 'system', content: systemPrompt },
      ];

      // 添加背景上下文（如果有）
      if (contextMessages && contextMessages.length > 0) {
        const context = this.extractContext(contextMessages);
        btwMessages.push(...context);
      }

      // 添加侧问题
      btwMessages.push({ role: 'user', content: questionPrompt });

      // 调用 AI
      const answer = await aiCall(btwMessages);

      const durationMs = Date.now() - startTime;
      logger.info(
        `BTW answer completed in ${durationMs}ms, using model: ${this.config.model}`
      );

      return {
        answer,
        durationMs,
        model: this.config.model,
        success: true,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      handleError(error, { module: 'agent:btw', action: 'BTW侧问题回答' });

      return {
        answer: '',
        durationMs,
        model: this.config.model,
        success: false,
        error: errorMessage,
      };
    }
  }
}
