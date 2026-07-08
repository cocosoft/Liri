import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveProjectRoot } from '@modules/core';
import type { ManagedProcess } from '@modules/daemon';

const logger = new Logger({
  module: 'chronos:autoDream:dreamAgentExecutor',
  level: LogLevel.INFO,
});

export interface DreamExecutionConfig {
  prompt: string;
  memoryRoot: string;
  transcriptDir: string;
  signal?: AbortSignal;
  onProgress?: (pct: number, msg: string) => void;
}

export interface DreamExecutionResult {
  success: boolean;
  filesTouched: string[];
  insightsGenerated: number;
  duration: number;
  error?: string;
}

interface WorkerProgress {
  type: 'progress';
  pct: number;
  message: string;
  filesTouched: string[];
}

interface WorkerResult {
  type: 'result';
  success: boolean;
  filesTouched: string[];
  insightsGenerated: number;
  duration: number;
  error?: string;
}

type WorkerMessage = WorkerProgress | WorkerResult;

const DEFAULT_MAX_DURATION_MS = 120_000;

export class DreamAgentExecutor extends EventEmitter implements ManagedProcess {
  readonly name = 'dream-consolidation';

  private child: ChildProcess | null = null;
  private resultPromise: Promise<DreamExecutionResult> | null = null;
  private filesTouched: string[] = [];
  private started = false;

  constructor(private config: DreamExecutionConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.resultPromise = this.execute();
    await this.resultPromise;
  }

  async stop(): Promise<void> {
    this.kill();
  }

  async healthCheck(): Promise<boolean> {
    return (
      this.child !== null && this.child.exitCode === null && !this.child.killed
    );
  }

  async waitForResult(): Promise<DreamExecutionResult> {
    if (!this.started) {
      await this.start();
    }
    return this.resultPromise!;
  }

  kill(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  private execute(): Promise<DreamExecutionResult> {
    const workerPath = path.join(
      resolveProjectRoot(),
      'app',
      'src',
      'chronos',
      'autoDream',
      'consolidationWorker.js'
    );
    const startTime = Date.now();
    const maxDuration = DEFAULT_MAX_DURATION_MS;

    return new Promise((resolve) => {
      const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          LIRI_DREAM_PROMPT: this.config.prompt,
          LIRI_DREAM_MEMORY_ROOT: this.config.memoryRoot,
          LIRI_DREAM_TRANSCRIPT_DIR: this.config.transcriptDir,
          LIRI_DREAM_MAX_DURATION: String(maxDuration),
        },
      });

      this.child = child;

      const timeout = setTimeout(() => {
        child.kill();
        resolve({
          success: false,
          filesTouched: this.filesTouched,
          insightsGenerated: 0,
          duration: Date.now() - startTime,
          error: 'consolidation timeout',
        });
      }, maxDuration + 15000);

      const abortHandler = () => {
        clearTimeout(timeout);
        child.kill();
        resolve({
          success: false,
          filesTouched: this.filesTouched,
          insightsGenerated: 0,
          duration: Date.now() - startTime,
          error: 'aborted by signal',
        });
      };

      if (this.config.signal) {
        if (this.config.signal.aborted) {
          clearTimeout(timeout);
          child.kill();
          resolve({
            success: false,
            filesTouched: [],
            insightsGenerated: 0,
            duration: 0,
            error: 'aborted before start',
          });
          return;
        }
        this.config.signal.addEventListener('abort', abortHandler);
      }

      child.on('message', (msg: WorkerMessage) => {
        if (msg.type === 'progress') {
          this.filesTouched = msg.filesTouched;
          this.config.onProgress?.(msg.pct, msg.message);
          this.emit('progress', msg.pct, msg.message);
        } else if (msg.type === 'result') {
          clearTimeout(timeout);
          if (this.config.signal) {
            this.config.signal.removeEventListener('abort', abortHandler);
          }
          this.cleanup();
          resolve({
            success: msg.success,
            filesTouched: msg.filesTouched,
            insightsGenerated: msg.insightsGenerated,
            duration: msg.duration,
            error: msg.error,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (this.config.signal) {
          this.config.signal.removeEventListener('abort', abortHandler);
        }
        this.cleanup();
        resolve({
          success: false,
          filesTouched: this.filesTouched,
          insightsGenerated: 0,
          duration: Date.now() - startTime,
          error: err.message,
        });
      });

      child.on('exit', (code) => {
        if (code !== 0 && this.child) {
          clearTimeout(timeout);
          if (this.config.signal) {
            this.config.signal.removeEventListener('abort', abortHandler);
          }
          resolve({
            success: false,
            filesTouched: this.filesTouched,
            insightsGenerated: 0,
            duration: Date.now() - startTime,
            error: `worker exited with code ${code}`,
          });
        }
      });
    });
  }

  private cleanup(): void {
    this.child = null;
  }
}
