import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import { resolveProjectRoot } from '@modules/core';

export interface ForkedDreamConfig {
  thinkingPrompt: string;
  maxDurationMs: number;
  workerScript?: string;
}

export interface ForkedDreamResult {
  type: 'result';
  thoughts: string[];
  conclusion: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface ForkedDreamProgress {
  type: 'thought';
  content: string;
}

export class ForkedDreamExecutor extends EventEmitter {
  private child: ChildProcess | null = null;
  private resultPromise: Promise<ForkedDreamResult>;

  constructor(private config: ForkedDreamConfig) {
    super();
    this.resultPromise = this.init();
  }

  private init(): Promise<ForkedDreamResult> {
    const workerPath =
      this.config.workerScript ||
      path.join(
        resolveProjectRoot(),
        'app',
        'src',
        'tasks',
        'dream',
        'dreamWorker.js'
      );

    return new Promise((resolve) => {
      const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          LIRI_DREAM_PROMPT: this.config.thinkingPrompt,
          LIRI_DREAM_MAX_DURATION: String(this.config.maxDurationMs),
        },
      });

      this.child = child;

      const timeout = setTimeout(() => {
        child.kill();
        resolve({
          type: 'result',
          thoughts: [],
          conclusion: '梦境执行超时',
          timestamp: Date.now(),
          durationMs: this.config.maxDurationMs,
          success: false,
          error: 'timeout',
        });
      }, this.config.maxDurationMs + 10000);

      child.on('message', (msg: ForkedDreamProgress | ForkedDreamResult) => {
        if (msg.type === 'thought') {
          this.emit('thought', msg.content);
        } else {
          clearTimeout(timeout);
          this.cleanup();
          resolve(msg);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.cleanup();
        resolve({
          type: 'result',
          thoughts: [],
          conclusion: '梦境执行失败',
          timestamp: Date.now(),
          durationMs:
            Date.now() - (this.config.maxDurationMs > 0 ? Date.now() : 0),
          success: false,
          error: err.message,
        });
      });

      child.on('exit', (code) => {
        if (code !== 0 && this.child) {
          clearTimeout(timeout);
          resolve({
            type: 'result',
            thoughts: [],
            conclusion: `梦境进程异常退出 (code=${code})`,
            timestamp: Date.now(),
            durationMs: 0,
            success: false,
            error: `exit_code_${code}`,
          });
        }
      });
    });
  }

  async waitForResult(): Promise<ForkedDreamResult> {
    return this.resultPromise;
  }

  kill(): void {
    if (this.child) {
      this.child.kill();
      this.cleanup();
    }
  }

  private cleanup(): void {
    this.child = null;
  }
}

export function createForkedDreamExecutor(
  thinkingPrompt: string,
  maxDurationMs: number
): ForkedDreamExecutor {
  return new ForkedDreamExecutor({ thinkingPrompt, maxDurationMs });
}
