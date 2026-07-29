/**
 * SignalWatcher — 文件变更信号监听
 *
 * P0-2: 双模式 — 优先 fs.watch（Linux/Mac），Windows 回退 30s polling。
 * 用于 DiscoveryGate.dormant_no_signal 判断：项目闲置但有文件变更 → 值得探查。
 */
import { watch, statSync } from 'fs';
import { cg3Log } from '../cg3Env';

export class SignalWatcher {
  private debounceMs: number;
  private lastSignal = 0;
  private watchPaths: string[] = [];
  private watchers: Array<ReturnType<typeof watch>> = [];
  /** poll 间隔（仅 Windows 回退模式使用） */
  private pollIntervalMs = 30_000;
  private pollTimer: NodeJS.Timeout | null = null;
  private usePolling: boolean;

  constructor(debounceMs = 2000, watchPaths: string[] = []) {
    this.debounceMs = debounceMs;
    this.watchPaths = watchPaths;
    // Windows 上 fs.watch 有已知限制，优先用 polling
    this.usePolling = process.platform === 'win32';
  }

  /** 设置监听路径 */
  setPaths(paths: string[]): void {
    this.watchPaths = paths;
  }

  /** 启动监听 */
  start(): void {
    if (this.usePolling) {
      this.startPolling();
    } else {
      this.startFileWatch();
    }
  }

  /** fs.watch 模式（Linux/Mac） */
  private startFileWatch(): void {
    for (const p of this.watchPaths) {
      try {
        const w = watch(p, { recursive: false }, (eventType) => {
          if (eventType === 'change' || eventType === 'rename') {
            this.recordSignal();
          }
        });
        w.on('error', (err) => {
          cg3Log('tasks:alwayson:signal', 'warn', 'watchError', {
            path: p,
            error: String(err),
          });
          // 如果 fs.watch 失败，回退到 polling
          if (!this.usePolling) {
            this.usePolling = true;
            this.closeAllWatchers();
            this.startPolling();
          }
        });
        this.watchers.push(w);
      } catch (err) {
        cg3Log('tasks:alwayson:signal', 'warn', 'watchSetupFailed', {
          path: p,
          error: String(err),
        });
      }
    }
    cg3Log('tasks:alwayson:signal', 'info', 'fileWatchStarted', {
      count: this.watchers.length,
    });
  }

  /** 30s stat polling 回退（Windows） */
  private startPolling(): void {
    cg3Log('tasks:alwayson:signal', 'info', 'pollingStarted', {
      intervalMs: this.pollIntervalMs,
      isWindows: process.platform === 'win32',
    });
    let lastMtimes = new Map<string, number>();

    const poll = () => {
      let changed = false;
      for (const p of this.watchPaths) {
        try {
          const stat = statSync(p);
          const prev = lastMtimes.get(p) ?? 0;
          if (stat.mtimeMs > prev) {
            changed = true;
            lastMtimes.set(p, stat.mtimeMs);
          }
        } catch {
          /* path may not exist */
        }
      }
      if (changed) this.recordSignal();

      if (changed) {
        // 检测到变更后加快轮询频率
        this.pollTimer = setTimeout(poll, this.debounceMs);
      } else {
        this.pollTimer = setTimeout(poll, this.pollIntervalMs);
      }
    };

    poll();
  }

  private recordSignal(): void {
    this.lastSignal = Date.now();
  }

  /** 是否有近期信号（debounce 窗口内） */
  hasSignal(): boolean {
    return Date.now() - this.lastSignal < this.debounceMs;
  }

  /** 停止监听 */
  stop(): void {
    this.closeAllWatchers();
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private closeAllWatchers(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* best effort */
      }
    }
    this.watchers = [];
  }
}
