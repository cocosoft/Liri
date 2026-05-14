import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 流式响应处理器
 *
 * 参考 cc_code/backend/utils/stream.ts 实现
 * 提供流式数据的异步迭代器支持
 */

export class Stream<T> implements AsyncIterableIterator<T> {
  private readonly queue: T[] = [];
  private readResolve?: (value: IteratorResult<T>) => void;
  private readReject?: (error: unknown) => void;
  private isDone: boolean = false;
  private hasError: unknown | undefined;
  private started = false;

  constructor(private readonly returned?: () => void) {}

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.started) {
      throw new AppError(
        'Stream can only be iterated once',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    this.started = true;
    return this;
  }

  next(): Promise<IteratorResult<T, unknown>> {
    if (this.queue.length > 0) {
      return Promise.resolve({
        done: false,
        value: this.queue.shift()!,
      });
    }
    if (this.isDone) {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (this.hasError) {
      return Promise.reject(this.hasError);
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.readResolve = resolve;
      this.readReject = reject;
    });
  }

  /**
   * 向队列添加数据
   */
  enqueue(value: T): void {
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: false, value });
    } else {
      this.queue.push(value);
    }
  }

  /**
   * 标记流结束
   */
  done(): void {
    this.isDone = true;
    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = undefined;
      this.readReject = undefined;
      resolve({ done: true, value: undefined });
    }
  }

  /**
   * 标记流错误
   */
  error(error: unknown): void {
    this.hasError = error;
    if (this.readReject) {
      const reject = this.readReject;
      this.readResolve = undefined;
      this.readReject = undefined;
      reject(error);
    }
  }

  /**
   * 返回并清理
   */
  return(): Promise<IteratorResult<T, unknown>> {
    this.isDone = true;
    if (this.returned) {
      this.returned();
    }
    return Promise.resolve({ done: true, value: undefined });
  }

  pipe<S>(
    scrubber: (source: AsyncIterableIterator<T>) => AsyncIterableIterator<S>
  ): Stream<S> {
    const target = new Stream<S>();
    const source = this;
    (async () => {
      for await (const chunk of scrubber(source)) {
        target.enqueue(chunk);
      }
      target.done();
    })().catch((err) => target.error(err));
    return target;
  }
}
