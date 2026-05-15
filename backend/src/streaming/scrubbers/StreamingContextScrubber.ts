/**
 * 流式上下文篱笆标签擦洗器
 * 对标 Hermes StreamingContextScrubber
 * 识别并替换 <memory-context> 篱笆标签内容
 */
import type { StreamChunk } from '../types';

/**
 * 上下文篱笆标签
 */
const CONTEXT_FENCE_OPEN = '<memory-context>';
const CONTEXT_FENCE_CLOSE = '</memory-context>';
const CONTEXT_FENCE_REPLACEMENT = '[memory context omitted]';

/**
 * 流式上下文标签擦洗器
 */
export class StreamingContextScrubber {
  private inFenceBlock: boolean = false;
  private buffer: string = '';
  private depth: number = 0;

  /**
   * 擦洗单个 chunk
   * @param chunk 流式 chunk
   * @returns 擦洗后的 chunk
   */
  scrub(chunk: StreamChunk): StreamChunk {
    if (!chunk.content || chunk.content.length === 0) {
      return chunk;
    }

    const content = this.buffer + chunk.content;
    this.buffer = '';

    let result = '';

    for (let i = 0; i < content.length; i++) {
      if (!this.inFenceBlock) {
        const remaining = content.slice(i);

        if (remaining.startsWith(CONTEXT_FENCE_OPEN)) {
          this.inFenceBlock = true;
          this.depth = 1;

          if (i === 0 || result.length === 0) {
            result += CONTEXT_FENCE_REPLACEMENT;
          } else {
            result += '\n' + CONTEXT_FENCE_REPLACEMENT;
          }

          i += CONTEXT_FENCE_OPEN.length - 1;

          continue;
        }

        if (remaining[0] === '<') {
          const checkLen = Math.min(
            CONTEXT_FENCE_OPEN.length,
            remaining.length
          );
          if (CONTEXT_FENCE_OPEN.startsWith(remaining.slice(0, checkLen))) {
            this.buffer = remaining.slice(0, checkLen);

            return {
              ...chunk,
              content: result,
              isComplete: chunk.isComplete,
            };
          }
        }

        result += content[i];
      } else {
        const remaining = content.slice(i);

        if (remaining.startsWith(CONTEXT_FENCE_OPEN)) {
          this.depth++;
          i += CONTEXT_FENCE_OPEN.length - 1;

          continue;
        }

        if (remaining.startsWith(CONTEXT_FENCE_CLOSE)) {
          this.depth--;

          if (this.depth <= 0) {
            this.inFenceBlock = false;
            this.depth = 0;
          }

          i += CONTEXT_FENCE_CLOSE.length - 1;

          continue;
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
   * @returns 残留内容
   */
  flush(): string {
    let result = '';

    if (!this.inFenceBlock) {
      result = this.buffer;
    }

    this.inFenceBlock = false;
    this.buffer = '';
    this.depth = 0;

    return result;
  }

  /**
   * 重置擦洗器状态
   */
  reset(): void {
    this.inFenceBlock = false;
    this.buffer = '';
    this.depth = 0;
  }

  /**
   * feed 方法 (等同于 scrub，兼容 Hermes 命名)
   * @param chunk 流式 chunk
   * @returns 擦洗后的 chunk
   */
  feed(chunk: StreamChunk): StreamChunk {
    return this.scrub(chunk);
  }
}
