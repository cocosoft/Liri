import { fork, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveProjectRoot } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

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

export class DreamAgentExecutor extends EventEmitter {
  private child: ChildProcess | null = null;
  private resultPromise: Promise<DreamExecutionResult>;
  private filesTouched: string[] = [];

  constructor(private config: DreamExecutionConfig) {
    super();
    this.resultPromise = this.execute();
  }

  async waitForResult(): Promise<DreamExecutionResult> {
    return this.resultPromise;
  }

  kill(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  private execute(): Promise<DreamExecutionResult> {
    const workerPath = path.join(resolveProjectRoot(), 'app', 'src', 'chronos', 'autoDream', 'consolidationWorker.js');
    const startTime = Date.now();
    const maxDuration = DEFAULT_MAX_DURATION_MS;

    return new Promise((resolve) => {
      const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          PYAPP_DREAM_PROMPT: this.config.prompt,
          PYAPP_DREAM_MEMORY_ROOT: this.config.memoryRoot,
          PYAPP_DREAM_TRANSCRIPT_DIR: this.config.transcriptDir,
          PYAPP_DREAM_MAX_DURATION: String(maxDuration),
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
