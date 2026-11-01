/**
 * 擦洗管道
 * 对标 Hermes 链式擦洗处理
 * 支持多个 Scrubber 组合应用
 */
import type { StreamChunk } from '../types';
import { StreamingThinkScrubber } from './StreamingThinkScrubber';
import { StreamingContextScrubber } from './StreamingContextScrubber';
import { StreamingToolCallScrubber } from './StreamingToolCallScrubber';

/**
 * 擦洗器接口
 */
export interface IScrubber {
  scrub(chunk: StreamChunk): StreamChunk;
  flush(): string;
  reset(): void;
}

/**
 * 擦洗管道
 * 按顺序应用多个擦洗器
 */
export class ScrubberPipeline {
  private scrubbers: IScrubber[];

  /**
   * 构造函数
   * @param scrubbers 擦洗器列表
   */
  constructor(scrubbers?: IScrubber[]) {
    this.scrubbers = scrubbers || [];
  }

  /**
   * 添加擦洗器
   * @param scrubber 擦洗器
   */
  addScrubber(scrubber: IScrubber): void {
    this.scrubbers.push(scrubber);
  }

  /**
   * 移除擦洗器
   * @param index 擦洗器索引
   */
  removeScrubber(index: number): void {
    if (index >= 0 && index < this.scrubbers.length) {
      this.scrubbers.splice(index, 1);
    }
  }

  /**
   * 获取擦洗器列表
   * @returns 擦洗器列表
   */
  getScrubbers(): IScrubber[] {
    return [...this.scrubbers];
  }

  /**
   * 应用管道擦洗
   * @param chunk 流式 chunk
   * @returns 擦洗后的 chunk
   */
  scrub(chunk: StreamChunk): StreamChunk {
    let current = chunk;

    for (const scrubber of this.scrubbers) {
      current = scrubber.scrub(current);
    }

    return current;
  }

  /**
   * 刷新所有擦洗器缓冲区
   * @returns 残留内容（拼接）
   */
  flush(): string {
    const parts: string[] = [];

    for (const scrubber of this.scrubbers) {
      const flushed = scrubber.flush();
      if (flushed) {
        parts.push(flushed);
      }
    }

    return parts.join('');
  }

  /**
   * 重置所有擦洗器
   */
  reset(): void {
    for (const scrubber of this.scrubbers) {
      scrubber.reset();
    }
  }

  /**
   * 清空擦洗器列表
   */
  clear(): void {
    this.scrubbers = [];
    this.reset();
  }
}

/**
 * 创建默认擦洗管道
 * 包含 StreamingToolCallScrubber + StreamingThinkScrubber + StreamingContextScrubber
 * @returns ScrubberPipeline
 */
export function createDefaultScrubberPipeline(): ScrubberPipeline {
  return new ScrubberPipeline([
    new StreamingToolCallScrubber(),
    new StreamingThinkScrubber(),
    new StreamingContextScrubber(),
  ]);
}

/**
 * 将 ScrubberPipeline 适配为 Stream.pipe 兼容的异步迭代器变换函数
 *
 * 用法:
 * ```ts
 * const stream = new Stream<StreamChunk>();
 * const pipeline = createDefaultScrubberPipeline();
 * const scrubbedStream = stream.pipe(createStreamScrubber(pipeline));
 * ```
 *
 * @param pipeline 擦洗管道
 * @returns 异步迭代器变换函数，可直接传入 Stream.pipe()
 */
export function createStreamScrubber(
  pipeline: ScrubberPipeline
): (
  source: AsyncIterableIterator<StreamChunk>
) => AsyncIterableIterator<StreamChunk> {
  return async function* scrubStream(source) {
    for await (const chunk of source) {
      const scrubbed = pipeline.scrub(chunk);

      if (scrubbed.content || scrubbed.isComplete) {
        yield scrubbed;
      }
    }

    const residual = pipeline.flush();
    if (residual) {
      yield { content: residual, isComplete: false };
    }

    pipeline.reset();
  };
}
