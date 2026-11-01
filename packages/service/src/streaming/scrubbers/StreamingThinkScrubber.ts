/**
 * 流式思考标签擦洗器
 * 对标 Hermes StreamingThinkScrubber
 * 跨 delta 边界识别并擦除思考标签，剥离响应标签（保留内容）
 */
import type { StreamChunk } from '../types';

/**
 * 支持的思考标签名（内容需要被擦除）
 * 含 XML 工具调用格式标签：模型偶发输出 Claude/Anthropic 风格 tool_calls
 * （<invoke>/<parameter>/</tool_calls> 等），非本系统 JSON schema，作为协议
 * 装饰整块擦除（2026-09-01 P1：修复 XML 残渣泄露到正文）。
 */
export const THINK_TAG_NAMES = [
  'think',
  'thinking',
  'reasoning',
  'thought',
  'reflection',
  'analysis',
  'internal',
  // XML 工具调用格式标签（Claude 风格，整块擦除）
  'tool_calls',
  'function_calls',
  'invoke',
  'parameter',
  'tool_name',
  'tool_use',
] as const;

/**
 * 响应标签名（只剥离标签，保留内容）
 */
export const RESPONSE_TAG_NAMES = ['response'] as const;

export type ThinkTagName = (typeof THINK_TAG_NAMES)[number];

/**
 * 擦洗状态
 */
interface ScrubState {
  mode: 'normal' | 'scrub' | 'strip'; // scrub=擦除内容, strip=剥离标签保留内容
  openTagBuffer: string;
  closeTagBuffer: string;
  depth: number;
}

/**
 * 构建标签正则集合
 */
function buildTagPatterns(): {
  thinkOpenPattern: RegExp;
  thinkClosePattern: RegExp;
  responseOpenPattern: RegExp;
  responseClosePattern: RegExp;
} {
  const thinkTagNames = THINK_TAG_NAMES.join('|');
  const responseTagNames = RESPONSE_TAG_NAMES.join('|');

  return {
    thinkOpenPattern: new RegExp(`<(${thinkTagNames})\\b[^>]*>`, 'i'),
    thinkClosePattern: new RegExp(`</(${thinkTagNames})\\s*>`, 'i'),
    responseOpenPattern: new RegExp(`<(${responseTagNames})\\b[^>]*>`, 'i'),
    responseClosePattern: new RegExp(`</(${responseTagNames})\\s*>`, 'i'),
  };
}

/**
 * 检查是否为不完整的标签开始
 * 覆盖流式半截前缀（如 '<invo' 是 '<invoke' 的前缀，2026-09-01 P1 修复）。
 */
function isIncompleteOpenTag(
  remaining: string,
  tagNames: readonly string[]
): boolean {
  for (const tagName of tagNames) {
    const openPrefix = `<${tagName}`;
    if (remaining.startsWith(openPrefix) && !remaining.includes('>')) {
      return true;
    }
    // 流式进行中：tagName 尚未完整输出
    if (
      remaining.length < openPrefix.length &&
      openPrefix.startsWith(remaining)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 检查是否为不完整的标签结束
 * 覆盖流式半截前缀（如 '</invo' 是 '</invoke' 的前缀）。
 */
function isIncompleteCloseTag(
  remaining: string,
  tagNames: readonly string[]
): boolean {
  for (const tagName of tagNames) {
    const closePrefix = `</${tagName}`;
    if (remaining.startsWith(closePrefix) && !remaining.includes('>')) {
      return true;
    }
    // 流式进行中：tagName 尚未完整输出
    if (
      remaining.length < closePrefix.length &&
      closePrefix.startsWith(remaining)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 流式思考标签擦洗器
 */
export class StreamingThinkScrubber {
  private thinkOpenPattern: RegExp;
  private thinkClosePattern: RegExp;
  private responseOpenPattern: RegExp;
  private responseClosePattern: RegExp;
  private state: ScrubState;

  /**
   * 构造函数
   */
  constructor() {
    const patterns = buildTagPatterns();
    this.thinkOpenPattern = patterns.thinkOpenPattern;
    this.thinkClosePattern = patterns.thinkClosePattern;
    this.responseOpenPattern = patterns.responseOpenPattern;
    this.responseClosePattern = patterns.responseClosePattern;
    this.state = {
      mode: 'normal',
      openTagBuffer: '',
      closeTagBuffer: '',
      depth: 0,
    };
  }

  /**
   * 擦洗单个 chunk
   * @param chunk 流式 chunk
   * @returns 擦洗后的 chunk
   */
  scrub(chunk: StreamChunk): StreamChunk {
    if (!chunk.content || chunk.content.length === 0) {
      return chunk;
    }

    // 合并上次未完成的标签缓冲区（可能是不完整的开始标签或结束标签）
    let content =
      this.state.openTagBuffer + this.state.closeTagBuffer + chunk.content;
    this.state.openTagBuffer = '';
    this.state.closeTagBuffer = '';

    let result = '';

    for (let i = 0; i < content.length; i++) {
      const remaining = content.slice(i);

      if (this.state.mode === 'normal') {
        // 检查思考标签开始（擦除模式）
        const thinkOpenMatch = remaining.match(this.thinkOpenPattern);
        if (thinkOpenMatch && thinkOpenMatch.index === 0) {
          this.state.mode = 'scrub';
          this.state.depth = 1;
          i += thinkOpenMatch[0].length - 1;
          continue;
        }

        // 孤立闭合标签（无配对开标签，如模型中途输出 </parameter>/</invoke> 残渣）
        // 2026-09-01 P1：否则单边闭合标签会作为普通文本泄露到正文。
        const orphanCloseMatch = remaining.match(this.thinkClosePattern);
        if (orphanCloseMatch && orphanCloseMatch.index === 0) {
          i += orphanCloseMatch[0].length - 1;
          continue;
        }

        // 检查响应标签开始（剥离模式，保留内容）
        const responseOpenMatch = remaining.match(this.responseOpenPattern);
        if (responseOpenMatch && responseOpenMatch.index === 0) {
          this.state.mode = 'strip';
          this.state.depth = 1;
          i += responseOpenMatch[0].length - 1;
          continue;
        }

        // 检查不完整的标签开始
        if (remaining[0] === '<') {
          if (
            isIncompleteOpenTag(remaining, [
              ...THINK_TAG_NAMES,
              ...RESPONSE_TAG_NAMES,
            ])
          ) {
            this.state.openTagBuffer = remaining;
            return {
              ...chunk,
              content: result,
              isComplete: chunk.isComplete,
            };
          }
          // P3-7c（2026-09-02）：normal 模式同样缓存半截**闭合**标签（</、</tool、</para...）。
          // 此前只检查开标签前缀——流式逐字符输出 "</tool_calls>" 时 "</"、"</tool" 等半截
          // 闭合标签不匹配任何开标签前缀，被当作普通文本逐字泄露到正文（实测 seq 1302-1307）。
          // 缓存后等待后续 chunk 拼成完整 </tool_calls>，由上方 orphanClose 分支整块剥离。
          if (isIncompleteCloseTag(remaining, THINK_TAG_NAMES)) {
            this.state.closeTagBuffer = remaining;
            return {
              ...chunk,
              content: result,
              isComplete: chunk.isComplete,
            };
          }
        }

        result += content[i];
      } else if (this.state.mode === 'scrub') {
        // 擦除模式：跳过内容，直到找到思考结束标签
        const closeMatch = remaining.match(this.thinkClosePattern);
        if (closeMatch && closeMatch.index === 0) {
          this.state.depth--;
          if (this.state.depth <= 0) {
            this.state.mode = 'normal';
            this.state.depth = 0;
          }
          i += closeMatch[0].length - 1;
          continue;
        }

        // 处理嵌套的思考标签
        const innerOpenMatch = remaining.match(this.thinkOpenPattern);
        if (innerOpenMatch && innerOpenMatch.index === 0) {
          this.state.depth++;
          i += innerOpenMatch[0].length - 1;
          continue;
        }

        // 检查不完整的结束标签
        if (remaining[0] === '<') {
          if (isIncompleteCloseTag(remaining, THINK_TAG_NAMES)) {
            this.state.closeTagBuffer = remaining;
            return {
              ...chunk,
              content: result,
              isComplete: chunk.isComplete,
            };
          }
        }
      } else if (this.state.mode === 'strip') {
        // 剥离模式：保留内容，只移除标签
        const closeMatch = remaining.match(this.responseClosePattern);
        if (closeMatch && closeMatch.index === 0) {
          this.state.depth--;
          if (this.state.depth <= 0) {
            this.state.mode = 'normal';
            this.state.depth = 0;
          }
          i += closeMatch[0].length - 1;
          continue;
        }

        // 处理嵌套的响应标签
        const innerOpenMatch = remaining.match(this.responseOpenPattern);
        if (innerOpenMatch && innerOpenMatch.index === 0) {
          this.state.depth++;
          i += innerOpenMatch[0].length - 1;
          continue;
        }

        // 检查不完整的结束标签
        if (remaining[0] === '<') {
          if (isIncompleteCloseTag(remaining, RESPONSE_TAG_NAMES)) {
            this.state.closeTagBuffer = remaining;
            return {
              ...chunk,
              content: result,
              isComplete: chunk.isComplete,
            };
          }
        }

        // 保留内容
        result += content[i];
      }
    }

    return {
      ...chunk,
      content: result,
      isComplete: chunk.isComplete,
    };
  }

  /**
   * 刷新缓冲区
   * 在流结束时调用，处理残留缓冲区内容
   * @returns 残留内容
   */
  flush(): string {
    let result = '';

    if (this.state.mode === 'normal') {
      result = this.state.openTagBuffer;
    } else if (this.state.mode === 'strip') {
      // 剥离模式下，如果标签未闭合，保留缓冲内容
      result = this.state.openTagBuffer;
    }

    this.state = {
      mode: 'normal',
      openTagBuffer: '',
      closeTagBuffer: '',
      depth: 0,
    };

    return result;
  }

  /**
   * 重置擦洗器状态
   */
  reset(): void {
    this.state = {
      mode: 'normal',
      openTagBuffer: '',
      closeTagBuffer: '',
      depth: 0,
    };
  }
}
