/**
 * 流式思考标签擦洗器
 * 对标 Hermes StreamingThinkScrubber
 * 跨 delta 边界识别并擦除 7 种思考标签
 */
import type { StreamChunk } from '../types';

/**
 * 支持的思考标签名
 */
export const THINK_TAG_NAMES = [
  'think',
  'thinking',
  'reasoning',
  'thought',
  'reflection',
  'analysis',
  'internal',
] as const;

export type ThinkTagName = (typeof THINK_TAG_NAMES)[number];

/**
 * 擦洗状态
 */
interface ScrubState {
  inThinkBlock: boolean;
  openTagBuffer: string;
  closeTagBuffer: string;
  depth: number;
}

/**
 * 构建标签正则集合
 */
function buildTagPatterns(): { openPattern: RegExp; closePattern: RegExp } {
  const tagNames = THINK_TAG_NAMES.join('|');
  const openPattern = new RegExp(`<(${tagNames})\\b[^>]*>`, 'i');
  const closePattern = new RegExp(`</(${tagNames})\\s*>`, 'i');

  return { openPattern, closePattern };
}

/**
 * 流式思考标签擦洗器
 */
export class StreamingThinkScrubber {
  private openPattern: RegExp;
  private closePattern: RegExp;
  private state: ScrubState;

  /**
   * 构造函数
   */
  constructor() {
    const { openPattern, closePattern } = buildTagPatterns();
    this.openPattern = openPattern;
    this.closePattern = closePattern;
    this.state = {
      inThinkBlock: false,
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

    let content = this.state.openTagBuffer + chunk.content;
    this.state.openTagBuffer = '';

    let result = '';

    for (let i = 0; i < content.length; i++) {
      const remaining = content.slice(i);

      if (!this.state.inThinkBlock) {
        const openMatch = remaining.match(this.openPattern);

        if (openMatch && openMatch.index === 0) {
          this.state.inThinkBlock = true;
          this.state.depth = 1;
          i += openMatch[0].length - 1;

          continue;
        }

        if (remaining[0] === '<') {
          const potentialTag = remaining.slice(0, 50);
          for (const tagName of THINK_TAG_NAMES) {
            if (
              potentialTag.startsWith(`<${tagName}`) &&
              !potentialTag.includes('>')
            ) {
              this.state.openTagBuffer = potentialTag;

              return {
                ...chunk,
                content: result,
                isComplete: chunk.isComplete,
              };
            }
          }
        }

        result += content[i];
      } else {
        const closeMatch = remaining.match(this.closePattern);

        if (closeMatch && closeMatch.index === 0) {
          this.state.depth--;

          if (this.state.depth <= 0) {
            this.state.inThinkBlock = false;
            this.state.depth = 0;
          }

          i += closeMatch[0].length - 1;

          continue;
        }

        const innerOpenMatch = remaining.match(this.openPattern);
        if (innerOpenMatch && innerOpenMatch.index === 0) {
          this.state.depth++;
          i += innerOpenMatch[0].length - 1;

          continue;
        }

        if (remaining[0] === '<') {
          const potentialClose = remaining.slice(0, 50);
          if (
            potentialClose.startsWith('</') &&
            !potentialClose.includes('>')
          ) {
            this.state.closeTagBuffer = potentialClose;

            return {
              ...chunk,
              content: result,
              isComplete: chunk.isComplete,
            };
          }
        }
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

    if (!this.state.inThinkBlock) {
      result = this.state.openTagBuffer;
    }

    this.state = {
      inThinkBlock: false,
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
      inThinkBlock: false,
      openTagBuffer: '',
      closeTagBuffer: '',
      depth: 0,
    };
  }
}
