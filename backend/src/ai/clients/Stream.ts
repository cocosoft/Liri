/**
 * SSE (Server-Sent Events) 流式处理工具
 * 提供可复用的流式解析基础设施，适用于 OpenAI 兼容 API
 */

import type { ChatResponse } from '../models/types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * SSE 事件类型
 */
export interface SSEEvent {
  data: string;
  event?: string;
  id?: string;
}

/**
 * OpenAI 兼容流式数据块
 */
export interface OpenAIStreamChunk {
  content: string;
  done: boolean;
  usage?: ChatResponse['usage'];
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

/**
 * SSE 流解析器
 * 从 ReadableStream<Uint8Array> 中解析 SSE 事件
 */
export class SSEStreamParser {
  private buffer: string = '';
  private decoder: TextDecoder;

  constructor() {
    this.decoder = new TextDecoder();
  }

  reset(): void {
    this.buffer = '';
  }

  parseChunk(chunk: Uint8Array): SSEEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.extractEvents();
  }

  finalize(): SSEEvent[] {
    const events = this.extractEvents();
    this.buffer = '';
    return events;
  }

  private extractEvents(): SSEEvent[] {
    const events: SSEEvent[] = [];
    const lines = this.buffer.split('\n');

    this.buffer = lines.pop() || '';

    let currentEvent: Partial<SSEEvent> = {};

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        currentEvent.data = (currentEvent.data || '') + data;
      } else if (line.startsWith('event: ')) {
        currentEvent.event = line.slice(7);
      } else if (line.startsWith('id: ')) {
        currentEvent.id = line.slice(4);
      } else if (line === '') {
        if (currentEvent.data !== undefined) {
          events.push(currentEvent as SSEEvent);
        }
        currentEvent = {};
      }
    }

    if (currentEvent.data !== undefined) {
      events.push(currentEvent as SSEEvent);
    }

    return events;
  }
}

/**
 * 从 ReadableStream 读取完整 SSE 事件（非流式）
 */
export async function readAllSSEEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<SSEEvent[]> {
  const parser = new SSEStreamParser();
  const reader = stream.getReader();
  const allEvents: SSEEvent[] = [];

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      const events = parser.parseChunk(value);
      allEvents.push(...events);
    }
  } finally {
    reader.releaseLock();
  }

  const finalEvents = parser.finalize();
  allEvents.push(...finalEvents);

  return allEvents;
}

/**
 * SSE 解析选项
 */
export interface SSEClientOptions {
  signal?: AbortSignal;
  onEvent?: (event: SSEEvent) => void;
}

/**
 * 异步迭代器：从 ReadableStream 中逐个产出 SSE 事件
 */
export async function* iterateSSEEvents(
  stream: ReadableStream<Uint8Array>,
  options?: SSEClientOptions
): AsyncGenerator<SSEEvent> {
  const parser = new SSEStreamParser();
  const reader = stream.getReader();

  try {
    while (true) {
      if (options?.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      const events = parser.parseChunk(value);
      for (const event of events) {
        options?.onEvent?.(event);
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const finalEvents = parser.finalize();
  for (const event of finalEvents) {
    options?.onEvent?.(event);
    yield event;
  }
}

/**
 * OpenAI 兼容流：从 fetch Response 中解析 chat.completion 流式数据
 * 逐块产出文本内容，最终返回完整的 ChatResponse
 */
export async function* streamOpenAICompatible(
  response: Response,
  options?: SSEClientOptions
): AsyncGenerator<OpenAIStreamChunk> {
  if (!response.body) {
    throw new AppError(
      'Response body is null',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  const parser = new SSEStreamParser();
  const reader = response.body.getReader();

  let fullContent = '';
  let usage: ChatResponse['usage'] | undefined;
  let toolCallAccumulator: Record<
    number,
    { id?: string; name?: string; arguments: string }
  > = {};
  let finishReason: string = 'stop';

  try {
    while (true) {
      if (options?.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      const events = parser.parseChunk(value);

      for (const event of events) {
        const data = event.data;
        if (data === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const choice = parsed.choices?.[0];
        if (!choice) {
          if (parsed.usage) {
            usage = mapUsage(parsed.usage);
          }
          continue;
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        if (choice.delta?.content) {
          fullContent += choice.delta.content;
          yield { content: choice.delta.content, done: false };
        }

        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!toolCallAccumulator[index]) {
              toolCallAccumulator[index] = { arguments: '' };
            }
            if (tc.id) toolCallAccumulator[index].id = tc.id;
            if (tc.function?.name)
              toolCallAccumulator[index].name = tc.function.name;
            if (tc.function?.arguments)
              toolCallAccumulator[index].arguments += tc.function.arguments;
          }
        }

        if (parsed.usage) {
          usage = mapUsage(parsed.usage);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const finalEvents = parser.finalize();
  for (const event of finalEvents) {
    const data = event.data;
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed.usage) {
        usage = mapUsage(parsed.usage);
      }
    } catch {
      // skip malformed final data
    }
  }

  const toolCalls = Object.values(toolCallAccumulator)
    .filter((tc) => tc.id && tc.name)
    .map((tc) => ({
      id: tc.id!,
      name: tc.name!,
      arguments: tc.arguments,
    }));

  yield {
    content: fullContent,
    done: true,
    usage,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function mapUsage(raw: any): ChatResponse['usage'] {
  return {
    prompt_tokens: raw.prompt_tokens || raw.promptTokens || 0,
    cache_read_input_tokens:
      raw.cache_read_input_tokens ?? raw.prompt_cache_hit_tokens ?? 0,
    cache_creation_input_tokens:
      raw.cache_creation_input_tokens ?? raw.prompt_cache_miss_tokens ?? 0,
    completion_tokens: raw.completion_tokens || raw.completionTokens || 0,
    total_tokens: raw.total_tokens || raw.totalTokens || 0,
  };
}

/**
 * 工具：从 URL 发起流式请求并解析
 */
export async function createOpenAIStream(
  url: string,
  body: Record<string, any>,
  apiKey: string,
  options?: SSEClientOptions
): Promise<AsyncGenerator<OpenAIStreamChunk>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new AppError(
      `OpenAI compatible API error: ${response.status} - ${errorText}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  return streamOpenAICompatible(response, options);
}
