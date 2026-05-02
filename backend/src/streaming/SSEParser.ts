/**
 * SSE (Server-Sent Events) 解析器
 *
 * 解析服务器发送的事件流
 */

import type { StreamEvent } from './types';

export class SSEParser {
  private buffer: string = '';

  /**
   * 解析 SSE 数据
   */
  parse(data: string): StreamEvent[] {
    this.buffer += data;
    const events: StreamEvent[] = [];

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    let currentEvent: Partial<StreamEvent> | null = null;
    let currentData: string = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        currentData += line.slice(6);
      } else if (line === '' && currentData) {
        try {
          const parsed = JSON.parse(currentData);
          events.push(parsed as StreamEvent);
        } catch (e) {
          console.error('Failed to parse SSE data:', currentData);
        }
        currentData = '';
      }
    }

    return events;
  }

  /**
   * 重置解析器
   */
  reset(): void {
    this.buffer = '';
  }
}

/**
 * 解析 OpenAI 格式的流式响应
 */
export function parseOpenAIStreamChunk(chunk: string): {
  content?: string;
  toolCalls?: { id: string; name: string; arguments: string; index: number }[];
  finishReason?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
} | null {
  try {
    const data = JSON.parse(chunk);
    const choice = data.choices?.[0];

    if (!choice) {
      return null;
    }

    const result: any = {};

    if (choice.delta?.content) {
      result.content = choice.delta.content;
    }

    if (choice.delta?.tool_calls) {
      result.toolCalls = choice.delta.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments || '',
        index: tc.index,
      }));
    }

    if (choice.finish_reason) {
      result.finishReason = choice.finish_reason;
    }

    if (data.usage) {
      result.usage = data.usage;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * 流式响应累加器
 */
export class StreamAccumulator {
  private content: string = '';
  private toolCalls: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

  /**
   * 添加内容
   */
  addContent(content: string): void {
    this.content += content;
  }

  /**
   * 添加工具调用
   */
  addToolCall(index: number, id: string, name: string, args: string): void {
    const existing = this.toolCalls.get(index);
    if (existing) {
      existing.arguments += args;
    } else {
      this.toolCalls.set(index, { id, name, arguments: args });
    }
  }

  /**
   * 获取累积的内容
   */
  getContent(): string {
    return this.content;
  }

  /**
   * 获取工具调用
   */
  getToolCalls(): { id: string; name: string; arguments: string }[] {
    return Array.from(this.toolCalls.values());
  }

  /**
   * 重置累加器
   */
  reset(): void {
    this.content = '';
    this.toolCalls.clear();
  }

  /**
   * 获取完整响应
   */
  getResponse(): {
    content: string;
    tool_calls: { id: string; function: string; arguments: string }[];
  } {
    return {
      content: this.content,
      tool_calls: Array.from(this.toolCalls.values()).map((tc) => ({
        id: tc.id,
        function: tc.name,
        arguments: tc.arguments,
      })),
    };
  }
}
