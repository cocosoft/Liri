/**
 * 对话标题自动生成器
 * 对标 Hermes agent/title_generator.py
 * 在首轮对话完成后异步生成简短标题
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'agent:titleGenerator',
  level: LogLevel.INFO,
});

const TITLE_PROMPT =
  'Generate a short, descriptive title (3-7 words) for a conversation that starts with the ' +
  'following exchange. The title should capture the main topic or intent. ' +
  'Return ONLY the title text, nothing else. No quotes, no punctuation at the end, no prefixes.';

const MAX_TITLE_LENGTH = 80;

export interface TitleGeneratorConfig {
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

const DEFAULT_CONFIG: TitleGeneratorConfig = {
  timeoutMs: 30000,
  maxTokens: 50,
  temperature: 0.3,
};

export type TitleGenerationCallback = (
  title: string | null,
  error?: Error
) => void;

/**
 * 对话消息接口
 */
export interface Message {
  role: string;
  content: string;
}

export class TitleGenerator {
  private config: TitleGeneratorConfig;
  private pendingGenerations: Map<string, Promise<string | null>> = new Map();

  constructor(config: Partial<TitleGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成对话标题（从消息列表提取首轮对话）
   * @param messages 对话消息列表（至少包含一条用户消息和一条助手回复）
   * @param callLLM LLM 调用函数（注入依赖，避免耦合具体模型）
   * @returns 标题文本或 null
   */
  async generateTitle(
    messages: Message[],
    callLLM: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<string | null>
  ): Promise<string | null>;

  /**
   * 生成对话标题（直接提供首轮对话文本）
   * @param userMessage 用户首条消息（截取前500字符）
   * @param assistantResponse 助手的首条回复（截取前500字符）
   * @param callLLM LLM 调用函数（注入依赖，避免耦合具体模型）
   * @returns 标题文本或 null
   */
  async generateTitle(
    userMessage: string,
    assistantResponse: string,
    callLLM: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<string | null>
  ): Promise<string | null>;

  /**
   * 生成对话标题（实现体）
   */
  async generateTitle(
    userMessageOrMessages: string | Message[],
    assistantResponseOrCallLLM:
      | string
      | ((
          messages: Array<{ role: string; content: string }>
        ) => Promise<string | null>),
    callLLM?: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<string | null>
  ): Promise<string | null> {
    let userSnippet: string;
    let assistantSnippet: string;
    let llmFn: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<string | null>;

    if (Array.isArray(userMessageOrMessages)) {
      const messages = userMessageOrMessages;
      const userMsg = messages.find((m) => m.role === 'user');
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      userSnippet = (userMsg?.content || '').slice(0, 500);
      assistantSnippet = (assistantMsg?.content || '').slice(0, 500);
      llmFn = assistantResponseOrCallLLM as (
        messages: Array<{ role: string; content: string }>
      ) => Promise<string | null>;
    } else {
      userSnippet = (userMessageOrMessages || '').slice(0, 500);
      assistantSnippet = ((assistantResponseOrCallLLM as string) || '').slice(
        0,
        500
      );
      llmFn = callLLM!;
    }

    try {
      const raw = await llmFn([
        { role: 'system', content: TITLE_PROMPT },
        {
          role: 'user',
          content: `User: ${userSnippet}\n\nAssistant: ${assistantSnippet}`,
        },
      ]);

      if (!raw) return null;

      return this.cleanTitle(raw);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.warning('Title generation failed', e);
      return null;
    }
  }

  /**
   * 异步生成标题（从消息列表，后台执行）
   * @param sessionId 会话ID
   * @param messages 对话消息列表
   * @param callLLM LLM调用函数
   * @param callback 结果回调
   */
  async generateTitleAsync(
    sessionId: string,
    messages: Message[],
    callLLM: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<string | null>,
    callback?: TitleGenerationCallback
  ): Promise<void>;

  /**
   * 异步生成标题（直接提供首轮对话文本，后台执行）
   * @param sessionId 会话ID
   * @param userMessage 用户消息
   * @param assistantResponse 助手回复
   * @param callLLM LLM调用函数
   * @param callback 结果回调
   */
  async generateTitleAsync(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    callLLM: (
      messages: Array<{ role: string; content: string }>
    ) => Promise<string | null>,
    callback?: TitleGenerationCallback
  ): Promise<void>;

  /**
   * 异步生成标题（后台执行，实现体）
   * @param sessionId 会话ID
   * @param userMessageOrMessages 用户消息或消息列表
   * @param assistantResponseOrCallLLM 助手回复或LLM调用函数
   * @param callLLMOrCallback LLM调用函数或回调
   * @param callback 结果回调
   */
  async generateTitleAsync(
    sessionId: string,
    userMessageOrMessages: string | Message[],
    assistantResponseOrCallLLM:
      | string
      | ((
          messages: Array<{ role: string; content: string }>
        ) => Promise<string | null>),
    callLLMOrCallback?:
      | ((
          messages: Array<{ role: string; content: string }>
        ) => Promise<string | null>)
      | TitleGenerationCallback,
    callback?: TitleGenerationCallback
  ): Promise<void> {
    let promise: Promise<string | null>;

    if (Array.isArray(userMessageOrMessages)) {
      promise = this.generateTitle(
        userMessageOrMessages,
        assistantResponseOrCallLLM as (
          messages: Array<{ role: string; content: string }>
        ) => Promise<string | null>
      );
      this.pendingGenerations.set(sessionId, promise);
      try {
        const title = await promise;
        (callLLMOrCallback as TitleGenerationCallback)?.(title);
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        (callLLMOrCallback as TitleGenerationCallback)?.(null, e);
      } finally {
        this.pendingGenerations.delete(sessionId);
      }
      return;
    }

    const userMessage = userMessageOrMessages as string;
    const assistantResponse = assistantResponseOrCallLLM as string;
    const callLLM = callLLMOrCallback as (
      messages: Array<{ role: string; content: string }>
    ) => Promise<string | null>;

    promise = this.generateTitle(userMessage, assistantResponse, callLLM);
    this.pendingGenerations.set(sessionId, promise);

    try {
      const title = await promise;
      callback?.(title);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      callback?.(null, e);
    } finally {
      this.pendingGenerations.delete(sessionId);
    }
  }

  /**
   * 清理标题文本
   * @param raw 原始标题
   * @returns 清理后的标题
   */
  private cleanTitle(raw: string): string | null {
    let title = raw.trim();

    title = title.replace(/^["']|["']$/g, '');

    if (title.toLowerCase().startsWith('title:')) {
      title = title.slice(6).trim();
    }

    title = title.replace(/[.!。,，]$/, '');

    if (title.length > MAX_TITLE_LENGTH) {
      title = title.slice(0, MAX_TITLE_LENGTH - 3) + '...';
    }

    return title || null;
  }

  getPendingCount(): number {
    return this.pendingGenerations.size;
  }
}

let globalTitleGenerator: TitleGenerator | null = null;

export function getTitleGenerator(
  config?: Partial<TitleGeneratorConfig>
): TitleGenerator {
  if (!globalTitleGenerator) {
    globalTitleGenerator = new TitleGenerator(config);
  }
  return globalTitleGenerator;
}

export function resetTitleGenerator(): void {
  globalTitleGenerator = null;
}
