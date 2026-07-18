//
/**
 * Streaming API 集成
 *
 * 将 API 客户端与流式输出模块连接，支持实时流式请求。
 * 使用原生 fetch API 读取 ReadableStream 并通过 Stream 类传递。
 */
import { ApiClient } from '../services/api';
import { Stream } from './Stream';
import { SSEParser } from './SSEParser';
import type { StreamChunk, StreamEvent } from './types';
import { ApiError, ApiConnectionError } from '../services/api';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'streaming:apiStream', level: LogLevel.INFO });

export class ApiStream {
  private client: ApiClient;
  private sseParser: SSEParser;

  constructor(client: ApiClient) {
    this.client = client;
    this.sseParser = new SSEParser();
  }

  async streamMessages(
    body: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      system?: string;
      max_tokens?: number;
      stream?: boolean;
      tools?: Array<Record<string, unknown>>;
    },
    options?: {
      signal?: AbortSignal;
      onChunk?: (chunk: StreamChunk) => void;
    }
  ): Promise<Stream<StreamChunk>> {
    const stream = new Stream<StreamChunk>();
    const requestBody = { ...body, stream: true };

    this.startStreaming(requestBody, stream, options).catch((err) => {
      stream.error(err);
    });

    return stream;
  }

  private async startStreaming(
    body: Record<string, unknown>,
    stream: Stream<StreamChunk>,
    options?: { signal?: AbortSignal; onChunk?: (chunk: StreamChunk) => void }
  ): Promise<void> {
    const controller = new AbortController();
    const signal = options?.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;

    const timeoutId = setTimeout(
      () => controller.abort(),
      this.client['config'].timeoutMs || 600000
    );

    try {
      const response = await fetch(`${this.client.getBaseUrl()}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.client['config'].apiKey || '',
          'anthropic-version': '2023-06-01',
        } as Record<string, string>,
        body: JSON.stringify(body),
        signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new ApiError(
          `Stream request failed: ${response.status}`,
          response.status,
          errorBody
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ApiConnectionError('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      let currentToolCalls: Map<
        number,
        { id: string; name: string; arguments: string }
      > = new Map();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = this.sseParser.parse(buffer);

        for (const event of events) {
          const chunk = this.processEvent(
            event,
            accumulatedContent,
            currentToolCalls
          );
          if (chunk) {
            stream.enqueue(chunk);
            options?.onChunk?.(chunk);
          }
        }
      }

      stream.enqueue({
        content: accumulatedContent,
        isComplete: true,
        toolCalls: Array.from(currentToolCalls.values()).map((tc) => ({
          ...tc,
          isComplete: true,
        })),
      });

      stream.done();
    } catch (error) {
      clearTimeout(timeoutId);
      stream.error(error);
    }
  }

  private processEvent(
    event: StreamEvent,
    accumulatedContent: string,
    currentToolCalls: Map<
      number,
      { id: string; name: string; arguments: string }
    >
  ): StreamChunk | null {
    switch (event.type) {
      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          accumulatedContent += event.delta.text;
          return {
            content: event.delta.text,
            isComplete: false,
          };
        }
        if (
          event.delta?.type === 'input_json_delta' &&
          event.delta.partial_json &&
          event.index !== undefined
        ) {
          const existing = currentToolCalls.get(event.index) || {
            id: '',
            name: '',
            arguments: '',
          };
          existing.arguments += event.delta.partial_json;
          currentToolCalls.set(event.index, existing);
        }
        break;

      case 'content_block_start':
        if (
          event.content_block?.type === 'tool_use' &&
          event.index !== undefined
        ) {
          currentToolCalls.set(event.index, {
            id: event.content_block.id || '',
            name: event.content_block.name || '',
            arguments: JSON.stringify(event.content_block.input || ''),
          });
          return {
            content: '',
            isComplete: false,
            toolCalls: [
              {
                id: event.content_block.id || '',
                name: event.content_block.name || '',
                arguments: JSON.stringify(event.content_block.input || ''),
                isComplete: false,
              },
            ],
          };
        }
        break;

      case 'message_stop':
        return {
          content: accumulatedContent,
          isComplete: true,
        };
    }

    return null;
  }
}
