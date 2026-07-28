/**
 * 流式工具调用标签擦洗器
 *
 * 擦洗系统已知能解析的 XML 工具调用格式:
 *   <tool_call>{"name": "func", "arguments": {...}}</tool_call>
 *   <tool_calls>...</tool_calls>
 *   <invoke name="func"><parameter name="x">v</parameter></invoke>
 *
 * 擦洗时注入进度提示（如 "[调用工具: glob...]"），让用户知道 AI 正在后台执行。
 *
 * 这些标签对应 HermesXmlParser / Glm45Parser / InvokeXmlParser 的解析格式。
 * 系统已将它们转为结构化 tool_calls 执行，无需在流式输出中暴露原始 XML。
 *
 * 对标 StreamingThinkScrubber 的设计模式。
 */
import type { StreamChunk } from '../types';

/** 需要擦洗的 XML 标签名（仅限系统 parser 已知的格式） */
const TOOL_CALL_TAG_NAMES = ['tool_call', 'tool_calls', 'invoke'] as const;

/** 从开标签中提取 name 属性值，如 <invoke name="glob"> → "glob" */
function extractToolName(tag: string): string | null {
  const match = tag.match(/name\s*=\s*["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/** 状态提示模板 */
const INDICATOR = (name: string | null) =>
  name ? `\n[调用工具: ${name}...]\n` : '\n[调用工具中...]\n';

function buildToolCallPatterns(): {
  openPattern: RegExp;
  closePattern: RegExp;
} {
  const tagNames = TOOL_CALL_TAG_NAMES.join('|');
  return {
    openPattern: new RegExp(`<(${tagNames})\\b[^>]*>`, 'i'),
    closePattern: new RegExp(`</(${tagNames})\\s*>`, 'i'),
  };
}

function isIncompleteOpenTag(remaining: string): boolean {
  for (const tagName of TOOL_CALL_TAG_NAMES) {
    if (remaining.startsWith(`<${tagName}`) && !remaining.includes('>')) {
      return true;
    }
  }
  return false;
}

function isIncompleteCloseTag(remaining: string): boolean {
  for (const tagName of TOOL_CALL_TAG_NAMES) {
    if (remaining.startsWith(`</${tagName}`) && !remaining.includes('>')) {
      return true;
    }
  }
  return false;
}

export class StreamingToolCallScrubber {
  private openPattern: RegExp;
  private closePattern: RegExp;
  private inToolCall: boolean = false;
  private openBuffer: string = '';
  private closeBuffer: string = '';
  private depth: number = 0;
  /** 当前工具调用块是否已注入过进度提示（防止多 chunk 重复注入） */
  private indicatorEmitted: boolean = false;

  constructor() {
    const patterns = buildToolCallPatterns();
    this.openPattern = patterns.openPattern;
    this.closePattern = patterns.closePattern;
  }

  scrub(chunk: StreamChunk): StreamChunk {
    if (!chunk.content || chunk.content.length === 0) {
      return chunk;
    }

    let content = this.openBuffer + this.closeBuffer + chunk.content;
    this.openBuffer = '';
    this.closeBuffer = '';

    let result = '';

    for (let i = 0; i < content.length; i++) {
      const remaining = content.slice(i);

      if (!this.inToolCall) {
        const openMatch = remaining.match(this.openPattern);
        if (openMatch && openMatch.index === 0) {
          const matchedTag = openMatch[0];
          // 自闭合标签直接跳过，不进入擦除模式
          if (matchedTag.endsWith('/>')) {
            i += matchedTag.length - 1;
            continue;
          }
          this.inToolCall = true;
          this.depth = 1;
          // 注入进度提示（每个工具调用块仅一次）
          if (!this.indicatorEmitted) {
            const toolName = extractToolName(matchedTag);
            result += INDICATOR(toolName);
            this.indicatorEmitted = true;
          }
          i += matchedTag.length - 1;
          continue;
        }

        if (remaining[0] === '<') {
          if (isIncompleteOpenTag(remaining)) {
            this.openBuffer = remaining;
            return { ...chunk, content: result, isComplete: chunk.isComplete };
          }
        }

        result += content[i];
      } else {
        const closeMatch = remaining.match(this.closePattern);
        if (closeMatch && closeMatch.index === 0) {
          this.depth--;
          if (this.depth <= 0) {
            this.inToolCall = false;
            this.depth = 0;
            this.indicatorEmitted = false;
          }
          i += closeMatch[0].length - 1;
          continue;
        }

        const innerOpen = remaining.match(this.openPattern);
        if (innerOpen && innerOpen.index === 0) {
          this.depth++;
          i += innerOpen[0].length - 1;
          continue;
        }

        if (remaining[0] === '<') {
          if (isIncompleteCloseTag(remaining)) {
            this.closeBuffer = remaining;
            return { ...chunk, content: result, isComplete: chunk.isComplete };
          }
        }
      }
    }

    return { ...chunk, content: result, isComplete: chunk.isComplete };
  }

  flush(): string {
    let result = '';
    if (!this.inToolCall) {
      result = this.openBuffer;
    }
    this.inToolCall = false;
    this.openBuffer = '';
    this.closeBuffer = '';
    this.depth = 0;
    this.indicatorEmitted = false;
    return result;
  }

  reset(): void {
    this.inToolCall = false;
    this.openBuffer = '';
    this.closeBuffer = '';
    this.depth = 0;
    this.indicatorEmitted = false;
  }

  feed(chunk: StreamChunk): StreamChunk {
    return this.scrub(chunk);
  }
}
