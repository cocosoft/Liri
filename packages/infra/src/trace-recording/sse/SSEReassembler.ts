/**
 * SSE 重组器 - 解析 SSE 字节流并重构完整 API 响应
 *
 * 支持的协议：
 * - Anthropic Messages API (message_start / content_block_delta / ...)
 * - OpenAI Responses API (response.created / response.done / ...)
 * - OpenAI Chat Completions (data: {"choices": [...]})
 *
 * 参考：claude-tap 的 SSEReassembler (Python 实现)
 */

import type { SSERawEvent } from '../types';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('trace-recording:sse:SSEReassembler');

/**
 * SSE 重组器
 */
export class SSEReassembler {
  /** 累积的SSE事件列表 */
  events: SSERawEvent[] = [];

  private buf: Uint8Array = new Uint8Array(0);
  private currentEvent: string | null = null;
  private currentDataLines: string[] = [];
  private snapshot: Record<string, unknown> | null = null;

  /**
   * 投喂 SSE 字节流
   * @param chunk 字节块
   */
  feedBytes(chunk: Uint8Array): void {
    const newBuf = new Uint8Array(this.buf.length + chunk.length);
    newBuf.set(this.buf);
    newBuf.set(chunk, this.buf.length);
    this.buf = newBuf;

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = decoder.decode(this.buf);
    const lines = text.split('\n');

    // 最后一个元素可能是不完整的行，保留到下次
    const completeLines = lines.slice(0, -1);
    this.buf = new TextEncoder().encode(lines[lines.length - 1]);

    for (const line of completeLines) {
      this.feedLine(line.replace(/\r$/, ''));
    }
  }

  /**
   * 处理一行SSE文本
   * @param line 单行文本
   */
  private feedLine(line: string): void {
    if (line.startsWith('event:')) {
      this.currentEvent = line.slice(6).trim();
      this.currentDataLines = [];
    } else if (line.startsWith('data:')) {
      this.currentDataLines.push(line.slice(5).trim());
    } else if (line === '') {
      // 空行触发事件发射
      if (this.currentEvent !== null || this.currentDataLines.length > 0) {
        const rawData = this.currentDataLines.join('\n');

        // OpenAI Chat Completions 终止标记
        if (rawData === '[DONE]' && this.currentEvent === null) {
          this.currentEvent = null;
          this.currentDataLines = [];
          return;
        }

        let data: unknown = rawData;
        try {
          data = JSON.parse(rawData);
        } catch (err) {
          // 保留原始字符串

          handleError(err, {
            module: 'trace-recording:sse',
            action: 'parseSSEData',
          });
        }

        const eventType = this.currentEvent || 'message';
        this.addEvent(eventType, data);
        this.currentEvent = null;
        this.currentDataLines = [];
      }
    }
  }

  /**
   * 添加已解析的SSE事件
   * @param eventType 事件类型
   * @param data 事件数据
   */
  addEvent(eventType: string, data: unknown): void {
    this.events.push({ event: eventType, data });
    this.accumulate(eventType, data);
  }

  /**
   * 累积事件到消息快照
   * @param eventType 事件类型
   * @param data 事件数据
   */
  private accumulate(eventType: string, data: unknown): void {
    if (typeof data !== 'object' || data === null) {
      return;
    }

    const d = data as Record<string, unknown>;

    try {
      if (eventType === 'message_start') {
        const message = d.message as Record<string, unknown> | undefined;
        if (message) {
          this.snapshot = this.deepClone(message);
        }
      } else if (
        eventType === 'response.created' ||
        eventType === 'response.completed' ||
        eventType === 'response.done'
      ) {
        const response = d.response as Record<string, unknown> | undefined;
        if (response) {
          this.snapshot = this.deepClone(response);
        } else if (
          eventType === 'response.completed' ||
          eventType === 'response.done'
        ) {
          this.snapshot = this.deepClone(d);
        }
      } else if (eventType === 'message' && 'choices' in d) {
        // OpenAI Chat Completions chunk
        this.accumulateChatCompletionChunk(d);
      } else if (this.snapshot === null) {
        return;
      } else if (eventType === 'content_block_start') {
        const block = this.deepClone(
          (d.content_block as Record<string, unknown>) || {}
        );
        if (!('content' in this.snapshot)) {
          this.snapshot.content = [];
        }
        const content = this.snapshot.content as unknown[];
        const idx = (d.index as number) ?? content.length;
        while (content.length <= idx) {
          content.push({});
        }
        content[idx] = block;
      } else if (eventType === 'content_block_delta') {
        const idx = (d.index as number) ?? 0;
        const delta = (d.delta as Record<string, unknown>) || {};
        const content = this.snapshot.content as
          | Record<string, unknown>[]
          | undefined;
        if (content && idx < content.length) {
          const block = content[idx];
          if (delta.type === 'text_delta') {
            block.text =
              ((block.text as string) || '') + ((delta.text as string) || '');
          } else if (delta.type === 'thinking_delta') {
            block.thinking =
              ((block.thinking as string) || '') +
              ((delta.thinking as string) || '');
          } else if (delta.type === 'input_json_delta') {
            block._partialJson =
              ((block._partialJson as string) || '') +
              ((delta.partial_json as string) || '');
          }
        }
      } else if (eventType === 'content_block_stop') {
        const idx = (d.index as number) ?? 0;
        const content = this.snapshot.content as
          | Record<string, unknown>[]
          | undefined;
        if (content && idx < content.length) {
          const block = content[idx];
          if ('_partialJson' in block) {
            try {
              block.input = JSON.parse(block._partialJson as string);
            } catch (err) {
              // partial JSON 不完整时保留原值

              handleError(err, {
                module: 'trace-recording:sse',
                action: 'parsePartialJsonInput',
              });
            }
            delete block._partialJson;
          }
        }
      } else if (eventType === 'message_delta') {
        const delta = (d.delta as Record<string, unknown>) || {};
        for (const [k, v] of Object.entries(delta)) {
          this.snapshot[k] = v;
        }
        const usage = d.usage as Record<string, unknown> | undefined;
        if (usage) {
          if (!('usage' in this.snapshot)) {
            this.snapshot.usage = {};
          }
          Object.assign(this.snapshot.usage as Record<string, unknown>, usage);
        }
      }
    } catch (err) {
      // 累积异常时静默忽略，不影响主流程

      handleError(err, {
        module: 'trace-recording:sse',
        action: 'accumulateStream',
      });
    }
  }

  /**
   * 累积 OpenAI Chat Completions chunk
   * @param data chunk 数据
   */
  private accumulateChatCompletionChunk(data: Record<string, unknown>): void {
    const choices = (data.choices as unknown[]) || [];
    const usage = data.usage as Record<string, unknown> | undefined;

    if (choices.length === 0) {
      if (usage && this.snapshot !== null) {
        this.mergeChatCompletionUsage(usage);
      }
      return;
    }

    const choice = (choices[0] as Record<string, unknown>) || {};
    const delta = (choice.delta as Record<string, unknown>) || {};
    const finishReason = choice.finish_reason;

    if (this.snapshot === null) {
      this.snapshot = {
        id: data.id || '',
        object: 'chat.completion',
        model: data.model || '',
        choices: [
          {
            index: 0,
            message: {
              role: (delta.role as string) || 'assistant',
              content: '',
            },
            finish_reason: null,
          },
        ],
        content: [{ type: 'text', text: '' }],
      };
    }

    const msg = (this.snapshot.choices as Record<string, unknown>[])[0]
      .message as Record<string, unknown>;
    const textBlock = (this.snapshot.content as Record<string, unknown>[])[0];

    if (typeof delta.role === 'string' && delta.role) {
      msg.role = delta.role;
    }
    if (typeof delta.content === 'string' && delta.content) {
      msg.content = ((msg.content as string) || '') + delta.content;
      textBlock.text = ((textBlock.text as string) || '') + delta.content;
    }

    // Tool calls accumulated by index
    const toolCallDeltas = delta.tool_calls as unknown[] | undefined;
    if (toolCallDeltas) {
      for (const tcDelta of toolCallDeltas) {
        if (typeof tcDelta !== 'object' || tcDelta === null) continue;
        const tc = tcDelta as Record<string, unknown>;
        const tcIdx = (tc.index as number) ?? 0;

        const toolCalls = (msg.tool_calls as Record<string, unknown>[]) || [];
        msg.tool_calls = toolCalls;
        while (toolCalls.length <= tcIdx) {
          toolCalls.push({
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          });
        }

        const existing = toolCalls[tcIdx];
        if (typeof tc.id === 'string') existing.id = tc.id;
        if (typeof tc.type === 'string') existing.type = tc.type;

        const fnDelta = tc.function as Record<string, unknown> | undefined;
        if (fnDelta) {
          const fn = (existing.function as Record<string, unknown>) || {
            name: '',
            arguments: '',
          };
          existing.function = fn;
          if (typeof fnDelta.name === 'string') {
            fn.name = ((fn.name as string) || '') + fnDelta.name;
          }
          if (typeof fnDelta.arguments === 'string') {
            fn.arguments = ((fn.arguments as string) || '') + fnDelta.arguments;
          }
        }

        this.mirrorToolCallToContent(tcIdx, existing);
      }
    }

    if (finishReason) {
      (this.snapshot.choices as Record<string, unknown>[])[0].finish_reason =
        finishReason;
    }

    if (usage) {
      this.mergeChatCompletionUsage(usage);
    }
  }

  /**
   * 镜像 tool_call 到 content 数组
   * @param idx 索引
   * @param tc tool call 对象
   */
  private mirrorToolCallToContent(
    idx: number,
    tc: Record<string, unknown>
  ): void {
    const content = this.snapshot!.content as Record<string, unknown>[];
    const target = idx + 1;
    while (content.length <= target) {
      content.push({ type: 'tool_use', id: '', name: '', input: {} });
    }
    const block = content[target];
    if (tc.id) block.id = tc.id;
    const fn = tc.function as Record<string, unknown> | undefined;
    if (fn?.name) block.name = fn.name;
    const argsStr = fn?.arguments as string | undefined;
    if (argsStr) {
      // 仅在 JSON 完整时解析 — 流式传输中 arguments 跨 chunk 断裂是预期行为，静默跳过
      try {
        block.input = JSON.parse(argsStr);
      } catch {
        // 参数仍在流式传输中，JSON 不完整，不记录日志
      }
    }
  }

  /**
   * 合并 OpenAI 格式的 usage
   * @param usage OpenAI usage 对象
   */
  private mergeChatCompletionUsage(usage: Record<string, unknown>): void {
    const merged: Record<string, unknown> = { ...usage };
    if ('prompt_tokens' in usage && !('input_tokens' in usage)) {
      merged.input_tokens = usage.prompt_tokens;
    }
    if ('completion_tokens' in usage && !('output_tokens' in usage)) {
      merged.output_tokens = usage.completion_tokens;
    }
    this.snapshot!.usage = merged;
  }

  /**
   * 获取当前已累积的所有事件
   * @returns SSE 事件列表
   */
  getEvents(): SSERawEvent[] {
    return this.events;
  }

  /**
   * 重构完整响应对象
   * @returns 重构后的响应对象，无数据时返回 null
   */
  reconstruct(): Record<string, unknown> | null {
    if (this.snapshot === null) {
      return null;
    }
    return this.deepClone(this.snapshot);
  }

  /**
   * 深拷贝对象
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}
