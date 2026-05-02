/**
 * AWS客户端实现
 */

import { LLMClient } from './LLMClient';
import type {
  LLMConfig,
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ThinkingConfig } from './thinking';

export class AWSClient extends LLMClient {
  constructor(config: LLMConfig) {
    super(config);
  }

  async chat(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): Promise<ChatResponse> {
    return {
      content: `AWS Bedrock response to: ${messages.map((m) => m.content).join(' ')}`,
      stop_reason: 'stop',
      tool_calls: options?.tools ? [] : undefined,
      usage: {
        prompt_tokens: messages.reduce(
          (sum, msg) => sum + msg.content.length,
          0
        ),
        completion_tokens: 100,
        total_tokens:
          100 + messages.reduce((sum, msg) => sum + msg.content.length, 0),
      },
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
      thinking?: ThinkingConfig;
    }
  ): AsyncGenerator<string, ChatResponse, unknown> {
    const response = 'AWS Bedrock streaming response...';
    for (const char of response) {
      yield char;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      content: response,
      stop_reason: 'stop',
      tool_calls: options?.tools ? [] : undefined,
      usage: {
        prompt_tokens: messages.reduce(
          (sum, msg) => sum + msg.content.length,
          0
        ),
        completion_tokens: response.length,
        total_tokens:
          response.length +
          messages.reduce((sum, msg) => sum + msg.content.length, 0),
      },
    };
  }
}
