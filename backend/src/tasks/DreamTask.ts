import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';
import { ForkedDreamExecutor } from './dream/ForkedDreamExecutor';

export interface DreamTaskOptions {
  thinkingPrompt: string;
  maxDuration?: number;
  cacheResult?: boolean;
  useForked?: boolean;
}

export interface DreamResult {
  thoughts: string[];
  conclusion: string;
  timestamp: number;
  success?: boolean;
}

export class DreamTask extends BaseTask {
  readonly type = TaskType.DREAM;
  private options: DreamTaskOptions;
  private executor: ForkedDreamExecutor | null = null;
  private cachedResult?: DreamResult;

  constructor(
    id: string,
    description: string,
    outputFile: string,
    options: DreamTaskOptions
  ) {
    super(id, description, outputFile, TaskType.DREAM);
    this.options = { maxDuration: 30000, useForked: true, ...options };
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    try {
      const maxDuration = this.options.maxDuration ?? 30000;

      this.executor = new ForkedDreamExecutor({
        thinkingPrompt: this.options.thinkingPrompt,
        maxDurationMs: maxDuration,
      });

      this.executor.on('thought', (thought: string) => {
        this.emit('output', { type: 'thought', content: thought });
        this.updateProgress(this.progressTracker.toolUseCount + 1, 0, 0);
      });

      const result = await this.executor.waitForResult();

      this.cachedResult = {
        thoughts: result.thoughts,
        conclusion: result.conclusion,
        timestamp: result.timestamp,
        success: result.success,
      };

      this.emit('output', { type: 'conclusion', content: result.conclusion });

      if (result.success) {
        this.setStatus(TaskStatus.COMPLETED);
      } else {
        this.setStatus(TaskStatus.FAILED, result.error || '梦境执行失败');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(TaskStatus.FAILED, message);
      throw error;
    }
  }

  async kill(): Promise<void> {
    this.abortController.abort();

    if (this.executor) {
      this.executor.kill();
      this.executor = null;
    }

    this.setStatus(TaskStatus.KILLED);
  }

  getCachedResult(): DreamResult | undefined {
    return this.cachedResult;
  }

  getThinkingPrompt(): string {
    return this.options.thinkingPrompt;
  }

  isResultCached(): boolean {
    return this.options.cacheResult !== false;
  }
}
