/**
 * Llama JSON 格式工具调用解析器
 * 对标 Hermes llama_parser.py（LlamaToolCallParser）
 *
 * 格式: 内嵌 JSON 对象，包含 name 和 arguments 字段
 * 采用平衡括号提取，兼容嵌套 JSON
 */
import { randomUUID } from 'node:crypto';
import { BaseParser } from './BaseParser';
import type { ParsedResult, ParsedToolCall } from './types';
import { emptyParsedResult, toolCallResult } from './types';

export class LlamaJsonParser extends BaseParser {
  readonly name = 'llama_json';

  readonly modelPatterns = [
    'llama-3',
    'llama3',
    'mistral',
    'mixtral',
    'kimi',
    'moonshot',
  ];

  override mayContainToolCalls(text: string): boolean {
    return text.includes('"name"');
  }

  parse(text: string): ParsedResult {
    const toolCalls: ParsedToolCall[] = [];
    let firstMatchIndex = -1;

    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '{') continue;

      const extracted = this.tryExtractJson(text, i);
      if (!extracted) continue;

      try {
        const parsed: unknown = JSON.parse(extracted.json);
        if (this.isToolCallLike(parsed)) {
          const tc = parsed as { name: string; arguments?: unknown; parameters?: unknown };
          const args = tc.arguments || tc.parameters || {};

          toolCalls.push({
            id: `call_${randomUUID().slice(0, 8)}`,
            name: tc.name,
            arguments: typeof args === 'string' ? args : JSON.stringify(args),
          });

          if (firstMatchIndex === -1) {
            firstMatchIndex = extracted.start;
          }
        }
      } catch {
        continue;
      }

      i = extracted.start + extracted.json.length - 1;
    }

    if (toolCalls.length === 0) {
      return emptyParsedResult(text);
    }

    const content = text.slice(0, firstMatchIndex).trim() || null;
    return toolCallResult(content, toolCalls);
  }

  /**
   * 从指定位置提取平衡括号的 JSON 字符串
   */
  private tryExtractJson(
    text: string,
    startPos: number
  ): { json: string; start: number } | null {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startPos; i < text.length; i++) {
      const ch = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const json = text.slice(startPos, i + 1);
          return { json, start: startPos };
        }
      }
    }

    return null;
  }

  /**
   * 判断解析出的 JSON 对象是否为工具调用格式
   */
  private isToolCallLike(obj: unknown): obj is Record<string, unknown> {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const record = obj as Record<string, unknown>;
    if (typeof record.name !== 'string' || record.name.length === 0) return false;
    return !this.isNonToolName(record.name);
  }

  private isNonToolName(name: string): boolean {
    const nonToolNames = new Set([
      'role', 'content', 'tool_calls', 'function', 'message',
      'type', 'text', 'image_url', 'input', 'output',
    ]);
    return nonToolNames.has(name);
  }
}
