/**
 * Dream任务（后台思考任务）
 * 基于CC源码 cc_code/backend/tasks/DreamTask.ts 实现
 */

import { BaseTask } from './BaseTask';
import { TaskType, TaskStatus } from './types';

export interface DreamTaskOptions {
  thinkingPrompt: string;
  maxDuration?: number;
  cacheResult?: boolean;
}

export interface DreamResult {
  thoughts: string[];
  conclusion: string;
  timestamp: number;
}

export class DreamTask extends BaseTask {
  readonly type = TaskType.DREAM;
  private options: DreamTaskOptions;
  private dreamProcess?: any;
  private cachedResult?: DreamResult;

  constructor(
    id: string,
    description: string,
    outputFile: string,
    options: DreamTaskOptions
  ) {
    super(id, description, outputFile, TaskType.DREAM);
    this.options = options;
  }

  async spawn(): Promise<void> {
    this.setStatus(TaskStatus.RUNNING);

    try {
      this.dreamProcess = await this.startDreaming();

      this.dreamProcess.on('thought', (thought: string) => {
        this.emit('output', { type: 'thought', content: thought });
        this.updateProgress(this.progressTracker.toolUseCount + 1, 0, 0);
      });

      this.dreamProcess.on('complete', (result: DreamResult) => {
        this.cachedResult = result;
        this.emit('output', { type: 'conclusion', content: result.conclusion });
        this.setStatus(TaskStatus.COMPLETED);
      });

      this.dreamProcess.on('error', (error: Error) => {
        this.setStatus(TaskStatus.FAILED, error.message);
      });

      await this.dreamProcess.completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(TaskStatus.FAILED, message);
      throw error;
    }
  }

  async kill(): Promise<void> {
    this.abortController.abort();

    if (this.dreamProcess) {
      this.dreamProcess.stop();
    }

    this.setStatus(TaskStatus.KILLED);
  }

  private async startDreaming(): Promise<unknown> {
    const { thinkingPrompt, maxDuration } = this.options;
    const thoughts: string[] = [];
    let completed: (result: DreamResult) => void;

    const process = {
      completed: new Promise<DreamResult>((resolve) => {
        completed = resolve;
      }),
      on: (event: string, callback: Function) => {
        if (event === 'thought') {
          setTimeout(() => {
            const sampleThoughts = [
              `分析问题: ${thinkingPrompt}`,
              '考虑可能的解决方案...',
              '评估各种选项的优缺点',
              '形成结论',
            ];

            for (let i = 0; i < sampleThoughts.length; i++) {
              setTimeout(() => {
                if (!this.abortController.signal.aborted) {
                  thoughts.push(sampleThoughts[i]);
                  callback(sampleThoughts[i]);
                }
              }, i * 500);
            }

            setTimeout(() => {
              const result: DreamResult = {
                thoughts,
                conclusion: `基于分析，关于"${thinkingPrompt}"的结论已形成。`,
                timestamp: Date.now(),
              };
              completed(result);
            }, 2500);
          }, 100);
        }
        return process;
      },
      stop: () => {},
    };

    return process;
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
