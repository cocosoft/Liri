/**
 * 流服务
 * 负责处理流式响应、解析流数据、累积流数据
 */
import type { StreamChunk, ChatResponse, Message } from '../types/message';
import { createAssistantMessage } from '../types/message';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 流服务接口
 */
export interface StreamService {
  /**
   * 处理流式响应
   * @param response 响应对象
   * @returns 异步生成器，产生流数据块
   */
  processStream(
    response: Response
  ): AsyncGenerator<string, ChatResponse, unknown>;

  /**
   * 解析流数据
   * @param chunk 流数据块
   * @returns 解析后的流数据块或null
   */
  parseStreamChunk(chunk: string): StreamChunk | null;

  /**
   * 累积流数据
   * @param data 流数据块
   */
  accumulateStreamData(data: StreamChunk): void;

  /**
   * 获取完整响应
   * @returns 完整的聊天响应
   */
  getCompleteResponse(): ChatResponse;

  /**
   * 重置流服务
   */
  reset(): void;

  /**
   * 处理SSE流
   * @param response 响应对象
   * @returns 异步生成器，产生流数据块
   */
  processSSEStream(
    response: Response
  ): AsyncGenerator<string, ChatResponse, unknown>;

  /**
   * 处理WebSocket流
   * @param socket WebSocket对象
   * @returns 异步生成器，产生流数据块
   */
  processWebSocketStream(
    socket: WebSocket
  ): AsyncGenerator<string, ChatResponse, unknown>;
}

/**
 * 流服务实现
 */
export class StreamServiceImpl implements StreamService {
  /**
   * 累积的内容
   */
  private accumulatedContent: string = '';

  /**
   * 累积的token使用情况
   */
  private accumulatedUsage:
    | {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }
    | undefined;

  /**
   * 模型名称
   */
  private model: string | undefined;

  /**
   * 完成原因
   */
  private finishReason: string | undefined;

  /**
   * 处理流式响应
   * @param response 响应对象
   * @returns 异步生成器，产生流数据块
   */
  async *processStream(
    response: Response
  ): AsyncGenerator<string, ChatResponse, unknown> {
    if (!response.body) {
      throw new AppError('Response body is null', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const streamChunk = this.parseStreamChunk(chunk);

        if (streamChunk) {
          this.accumulateStreamData(streamChunk);
          yield streamChunk.content;
        }
      }
    } finally {
      reader.releaseLock();
    }

    return this.getCompleteResponse();
  }

  /**
   * 解析流数据
   * @param chunk 流数据块
   * @returns 解析后的流数据块或null
   */
  parseStreamChunk(chunk: string): StreamChunk | null {
    // 解析SSE格式的数据
    const lines = chunk.split('\n');
    let content = '';
    let isComplete = false;
    let usage = this.accumulatedUsage;
    let model = this.model;
    let finishReason = this.finishReason;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('data:')) {
        const data = trimmedLine.substring(5).trim();

        if (data === '[DONE]') {
          isComplete = true;
          break;
        }

        try {
          const parsedData = JSON.parse(data);

          // 处理不同格式的流数据
          if (parsedData.choices && parsedData.choices.length > 0) {
            const choice = parsedData.choices[0];

            if (choice.delta && choice.delta.content) {
              content += choice.delta.content;
            }

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
              isComplete = true;
            }
          }

          if (parsedData.usage) {
            usage = {
              inputTokens: parsedData.usage.prompt_tokens || 0,
              outputTokens: parsedData.usage.completion_tokens || 0,
              totalTokens: parsedData.usage.total_tokens || 0,
            };
          }

          if (parsedData.model) {
            model = parsedData.model;
          }
        } catch (error) {
          // 忽略解析错误
        }
      }
    }

    if (content === '' && !isComplete && !usage && !model) {
      return null;
    }

    return {
      content,
      isComplete,
      usage,
      model,
      finishReason,
    };
  }

  /**
   * 累积流数据
   * @param data 流数据块
   */
  accumulateStreamData(data: StreamChunk): void {
    this.accumulatedContent += data.content;

    if (data.usage) {
      this.accumulatedUsage = data.usage;
    }

    if (data.model) {
      this.model = data.model;
    }

    if (data.finishReason) {
      this.finishReason = data.finishReason;
    }
  }

  /**
   * 获取完整响应
   * @returns 完整的聊天响应
   */
  getCompleteResponse(): ChatResponse {
    const message = createAssistantMessage(this.accumulatedContent);

    return {
      message,
      usage: this.accumulatedUsage,
      model: this.model,
      finishReason: this.finishReason,
    };
  }

  /**
   * 重置流服务
   */
  reset(): void {
    this.accumulatedContent = '';
    this.accumulatedUsage = undefined;
    this.model = undefined;
    this.finishReason = undefined;
  }

  /**
   * 处理SSE流
   * @param response 响应对象
   * @returns 异步生成器，产生流数据块
   */
  async *processSSEStream(
    response: Response
  ): AsyncGenerator<string, ChatResponse, unknown> {
    return yield* this.processStream(response);
  }

  /**
   * 处理WebSocket流
   * @param socket WebSocket对象
   * @returns 异步生成器，产生流数据块
   */
  async *processWebSocketStream(
    socket: WebSocket
  ): AsyncGenerator<string, ChatResponse, unknown> {
    return new Promise((resolve, reject) => {
      socket.onmessage = (event) => {
        const chunk = event.data;
        const streamChunk = this.parseStreamChunk(chunk);

        if (streamChunk) {
          this.accumulateStreamData(streamChunk);
          // 这里需要处理异步生成器的yield，暂时简化处理
        }
      };

      socket.onclose = () => {
        resolve(this.getCompleteResponse());
      };

      socket.onerror = (error) => {
        reject(error);
      };
    });
  }
}

/**
 * 创建流服务实例
 * @returns 流服务实例
 */
export function createStreamService(): StreamService {
  return new StreamServiceImpl();
}
