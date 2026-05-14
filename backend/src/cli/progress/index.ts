/**
 * CLI Progress Display
 * 对标OpenClaw cli/progress.ts
 * 进度显示系统，支持spinner/progress bar/百分比
 */

export type ProgressMode = 'spinner' | 'bar' | 'percentage' | 'indeterminate';

export interface ProgressOptions {
  mode?: ProgressMode;
  total?: number;
  message?: string;
  format?: string;
  barLength?: number;
  showPercentage?: boolean;
  showSpeed?: boolean;
  showETA?: boolean;
  stream?: NodeJS.WriteStream;
}

export interface ProgressState {
  current: number;
  total: number;
  message: string;
  startTime: number;
  lastUpdate: number;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BAR_CHARS = { filled: '█', empty: '░', head: '█' };

export class ProgressDisplay {
  private options: Required<ProgressOptions>;
  private state: ProgressState;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private frameIndex: number = 0;
  private running: boolean = false;

  constructor(options?: ProgressOptions) {
    this.options = {
      mode: options?.mode ?? 'spinner',
      total: options?.total ?? 100,
      message: options?.message ?? '',
      format: options?.format ?? '{spinner} {message} {percentage}',
      barLength: options?.barLength ?? 30,
      showPercentage: options?.showPercentage ?? true,
      showSpeed: options?.showSpeed ?? false,
      showETA: options?.showETA ?? false,
      stream: options?.stream ?? process.stderr,
    };

    this.state = {
      current: 0,
      total: this.options.total,
      message: this.options.message,
      startTime: Date.now(),
      lastUpdate: Date.now(),
    };
  }

  start(message?: string): void {
    if (this.running) return;
    this.running = true;

    if (message) {
      this.state.message = message;
    }

    this.state.startTime = Date.now();
    this.state.lastUpdate = Date.now();

    if (this.options.mode === 'spinner' || this.options.mode === 'indeterminate') {
      this.intervalId = setInterval(() => this.render(), 80);
    }

    this.render();
  }

  update(current: number, message?: string): void {
    this.state.current = Math.min(current, this.state.total);
    this.state.lastUpdate = Date.now();

    if (message) {
      this.state.message = message;
    }

    if (this.options.mode !== 'spinner' && this.options.mode !== 'indeterminate') {
      this.render();
    }
  }

  increment(step: number = 1, message?: string): void {
    this.update(this.state.current + step, message);
  }

  setMessage(message: string): void {
    this.state.message = message;
  }

  setTotal(total: number): void {
    this.state.total = total;
  }

  complete(message?: string): void {
    this.stop();
    this.state.current = this.state.total;

    if (message) {
      this.state.message = message;
    }

    this.render();
  }

  fail(message?: string): void {
    this.stop();
    if (message) {
      this.state.message = message;
    }
    this.render();
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private render(): void {
    const stream = this.options.stream;
    const cursorHide = '\u001B[?25l';
    const cursorShow = '\u001B[?25h';
    const clearLine = '\u001B[2K\r';

    let output = this.options.format;

    switch (this.options.mode) {
      case 'spinner':
        output = output
          .replace('{spinner}', SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length])
          .replace('{message}', this.state.message)
          .replace('{percentage}', '');
        this.frameIndex++;
        break;

      case 'indeterminate':
        output = output
          .replace('{spinner}', this.renderIndeterminateBar())
          .replace('{message}', this.state.message)
          .replace('{percentage}', '');
        break;

      case 'bar':
        output = output
          .replace('{spinner}', this.renderProgressBar())
          .replace('{message}', this.state.message)
          .replace('{percentage}', this.renderPercentage());
        break;

      case 'percentage':
        output = output
          .replace('{spinner}', '')
          .replace('{message}', this.state.message)
          .replace('{percentage}', this.renderPercentage());
        break;
    }

    if (this.options.showSpeed) {
      const speed = this.calculateSpeed();
      output += ` [${speed}/s]`;
    }

    if (this.options.showETA && this.state.current > 0) {
      const eta = this.calculateETA();
      output += ` ETA: ${eta}`;
    }

    if (!this.running) {
      stream.write(`${clearLine}${output}\n${cursorShow}`);
    } else {
      stream.write(`${cursorHide}${clearLine}${output}`);
    }
  }

  private renderProgressBar(): string {
    const percent = this.state.total > 0
      ? this.state.current / this.state.total
      : 0;
    const filled = Math.round(percent * this.options.barLength);
    const empty = this.options.barLength - filled;

    return BAR_CHARS.filled.repeat(filled) + BAR_CHARS.empty.repeat(empty);
  }

  private renderIndeterminateBar(): string {
    const pos = this.frameIndex % (this.options.barLength * 2);
    const position = pos < this.options.barLength ? pos : this.options.barLength * 2 - pos;

    const bar = BAR_CHARS.empty.repeat(position) +
      BAR_CHARS.head +
      BAR_CHARS.empty.repeat(this.options.barLength - position - 1);

    this.frameIndex++;
    return bar;
  }

  private renderPercentage(): string {
    if (this.state.total <= 0) return '0%';
    const percent = Math.round((this.state.current / this.state.total) * 100);
    return `${percent}%`;
  }

  private calculateSpeed(): string {
    const elapsed = (Date.now() - this.state.startTime) / 1000;
    if (elapsed <= 0) return '0';
    const speed = Math.round(this.state.current / elapsed);
    return `${speed}`;
  }

  private calculateETA(): string {
    const elapsed = (Date.now() - this.state.startTime) / 1000;
    if (this.state.current <= 0 || elapsed <= 0) return '--';

    const rate = this.state.current / elapsed;
    const remaining = (this.state.total - this.state.current) / rate;

    if (remaining < 60) return `${Math.round(remaining)}s`;
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.round(remaining % 60);
    return `${minutes}m ${seconds}s`;
  }

  getState(): Readonly<ProgressState> {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.running;
  }
}

export function createSpinner(message?: string): ProgressDisplay {
  return new ProgressDisplay({ mode: 'spinner', message });
}

export function createProgressBar(total: number, message?: string): ProgressDisplay {
  return new ProgressDisplay({ mode: 'bar', total, message });
}

export function createPercentage(message?: string): ProgressDisplay {
  return new ProgressDisplay({ mode: 'percentage', message });
}
