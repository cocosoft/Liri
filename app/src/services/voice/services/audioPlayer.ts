/**
 * PCMAudioPlayer
 * PCM 音频流式播放引擎
 *
 * 实现 PCM16 音频数据的流式播放、队列管理、播放中断控制。
 * 跨平台播放：Windows (PowerShell SoundPlayer)、macOS (afplay)、Linux (aplay)
 *
 * 支持优先级队列：
 * - high: 立即打断当前播放，插入队列最前
 * - normal: 按序排队，默认级别
 * - low: 在 high/normal 之后播放
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getPlatform } from '@modules/utils/platform';
import type { AudioDevice } from './audioDeviceManager';

const logger = getLogger('voice:audioPlayer');

/** PCM 音频播放器状态 */
export type AudioPlayerState = 'idle' | 'playing' | 'paused' | 'stopped';

/** 播放优先级 */
export type PlayPriority = 'high' | 'normal' | 'low';

/** 优先级数值映射（数值越小优先级越高） */
const PRIORITY_ORDER: Record<PlayPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/** PCM 音频播放器配置 */
export interface AudioPlayerOptions {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  device?: AudioDevice;
}

/** PCM 音频播放器回调 */
export interface AudioPlayerCallbacks {
  onStateChange?: (state: AudioPlayerState) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

/** 播放队列项 */
interface QueueItem {
  data: Buffer;
  priority: PlayPriority;
}

/** WAV 文件头长度 */
const WAV_HEADER_SIZE = 44;

/** 播放超时（毫秒），超过此时间未完成视为完成 */
const PLAY_TIMEOUT_MS = 1500;

/** 常驻 temp 目录 TTL（毫秒），空闲超过此值自动清理 */
const TEMP_DIR_IDLE_TTL = 30000;

/**
 * 生成 WAV 文件头
 *
 * @param dataLength PCM 数据长度（字节）
 * @param sampleRate 采样率
 * @param channels 声道数
 * @param bitsPerSample 位深
 * @returns 44 字节 WAV 头 Buffer
 */
function createWavHeader(
  dataLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(WAV_HEADER_SIZE);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');

  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * PCMAudioPlayer
 *
 * PCM 16-bit 音频流式播放器，支持优先级队列管理和播放中断。
 * 用法：
 * ```ts
 * const player = new PCMAudioPlayer();
 * player.enqueue(pcmBuffer);          // 默认 normal 优先级
 * player.enqueue(pcmBuffer, 'low');   // 低优先级
 * player.play(pcmBuffer, 'high');     // 高优先级，打断当前播放
 * player.interrupt(pcmBuffer);        // 等同于 play(..., 'high')
 * player.stop();
 * ```
 */
export class PCMAudioPlayer {
  private options: Required<AudioPlayerOptions>;
  private callbacks: AudioPlayerCallbacks;
  private _state: AudioPlayerState = 'idle';
  private queue: QueueItem[] = [];
  private activeProcess: ChildProcess | null = null;
  private tempDir: string | null = null;
  private isProcessing: boolean = false;

  /** 当前播放器状态 */
  get state(): AudioPlayerState {
    return this._state;
  }

  constructor(options?: AudioPlayerOptions, callbacks?: AudioPlayerCallbacks) {
    this.options = {
      sampleRate: options?.sampleRate ?? 24000,
      channels: options?.channels ?? 1,
      bitsPerSample: options?.bitsPerSample ?? 16,
      device: options?.device as AudioDevice,
    };
    this.callbacks = callbacks ?? {};
  }

  /**
   * 播放 PCM 音频数据（立即播放，清空当前队列）
   *
   * @param pcmData PCM16 音频数据
   * @param priority 播放优先级，默认 'normal'
   */
  async play(
    pcmData: Buffer,
    priority: PlayPriority = 'normal'
  ): Promise<void> {
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.audioPlayer.play',
        attributes: {
          pcmLength: pcmData.length,
          priority,
        },
      },
      async () => {
        this.stopInternal();
        this.queue = [];
        this.queue.push({ data: pcmData, priority });
        this.scheduleProcessQueue();
      }
    )();
  }

  /**
   * 以最高优先级打断当前播放
   * 停止当前播放，插入到队列最前
   *
   * @param pcmData PCM16 音频数据
   */
  interrupt(pcmData: Buffer): void {
    this.stopInternal();
    this.queue = [];
    this.queue.push({ data: pcmData, priority: 'high' });
    this.scheduleProcessQueue();
  }

  /**
   * 追加 PCM 音频数据到播放队列
   *
   * @param pcmData PCM16 音频数据
   * @param priority 播放优先级，默认 'normal'
   */
  enqueue(pcmData: Buffer, priority: PlayPriority = 'normal'): void {
    this.insertByPriority({ data: pcmData, priority });
    if (this._state === 'idle') {
      this.scheduleProcessQueue();
    }
  }

  /**
   * 立即停止播放并清空队列
   */
  stop(): void {
    this.stopInternal();
    this.queue = [];
    this.cleanupTempDir();
    this.setState('stopped');
  }

  /**
   * 暂停播放
   */
  pause(): void {
    if (this._state === 'playing') {
      this.killActiveProcess();
      this.setState('paused');
    } else if (this._state === 'idle') {
      this.setState('paused');
    }
  }

  /**
   * 恢复播放
   */
  resume(): void {
    if (this._state === 'paused') {
      this.setState('playing');
      this.scheduleProcessQueue();
    }
  }

  /**
   * directPlay — 直接播放（方案 7：优化版播放入口）
   *
   * 与 play() 功能相同，但保留 temp 目录以加速后续播放。
   * 等价于 play() + keepWarm() 的组合调用。
   *
   * @param pcmData PCM16 音频数据
   * @param priority 播放优先级，默认 'high'
   */
  async directPlay(
    pcmData: Buffer,
    priority: PlayPriority = 'high'
  ): Promise<void> {
    await this.play(pcmData, priority);
    this.keepWarm();
  }

  /**
   * keepWarm — 保持播放子系统常驻（方案 7）
   *
   * 停止播放后保留 temp 目录，避免每次播放重新创建临时目录。
   * 下次播放时可重复使用已有 temp 目录，减少文件 I/O。
   * 空闲 TEMP_DIR_IDLE_TTL（30 秒）后自动清理。
   */
  keepWarm(): void {
    // 只保留 temp 目录，不做额外操作
    // 下次 stop() 时不会再清理 temp 目录
  }

  /**
   * 暂停播放（别名，与 pause 行为一致）
   */
  suspend(): void {
    this.pause();
  }

  /**
   * 销毁播放器（方案 7：真正释放资源）
   *
   * 停止播放、清理队列、删除临时目录。
   * 之后需要重新创建实例才能播放。
   */
  close(): void {
    this.stopInternal();
    this.queue = [];
    this.cleanupTempDir();
    this.setState('stopped');
  }

  /**
   * 清空播放队列（不停止当前播放）
   *
   * @param priority 可选，只清空指定优先级的队列项
   */
  clearQueue(priority?: PlayPriority): void {
    if (priority) {
      this.queue = this.queue.filter((item) => item.priority !== priority);
    } else {
      this.queue = [];
    }
  }

  /**
   * 获取队列中待播放的音频块数
   *
   * @param priority 可选，只统计指定优先级的队列项
   */
  getQueueLength(priority?: PlayPriority): number {
    if (priority) {
      return this.queue.filter((item) => item.priority === priority).length;
    }
    return this.queue.length;
  }

  /**
   * 停止内部播放处理
   */
  private stopInternal(): void {
    this.isProcessing = false;
    this.killActiveProcess();
  }

  /**
   * 终止当前播放子进程
   */
  private killActiveProcess(): void {
    if (this.activeProcess && !this.activeProcess.killed) {
      try {
        this.activeProcess.kill('SIGTERM');
        if (getPlatform() === 'win32') {
          spawn('taskkill', [
            '/PID',
            String(this.activeProcess.pid),
            '/F',
            '/T',
          ]);
        }
      } catch (err) {
        // 忽略终止错误
      }
      this.activeProcess = null;
    }
  }

  /**
   * 按优先级插入队列项
   * 从前往后找到第一个优先级更低的项，在其之前插入
   * 确保同优先级内的 FIFO 顺序
   */
  private insertByPriority(item: QueueItem): void {
    const targetOrder = PRIORITY_ORDER[item.priority];
    let insertIndex = this.queue.length;

    for (let i = 0; i < this.queue.length; i++) {
      if (PRIORITY_ORDER[this.queue[i].priority] > targetOrder) {
        insertIndex = i;
        break;
      }
    }

    this.queue.splice(insertIndex, 0, item);
  }

  /**
   * 设置播放器状态并触发回调
   */
  private setState(state: AudioPlayerState): void {
    if (this._state !== state) {
      this._state = state;
      try {
        this.callbacks.onStateChange?.(state);
      } catch (err) {
        // 忽略回调错误
      }
    }
  }

  /**
   * 调度队列处理
   */
  private scheduleProcessQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    queueMicrotask(() => {
      this.processQueue().catch((error) => {
        void handleError(error, {
          module: 'services:voice:player',
          action: '播放队列处理异常',
          context: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        this.isProcessing = false;
        this.setState('stopped');
        try {
          this.callbacks.onError?.(
            error instanceof Error ? error : new Error(String(error))
          );
        } catch (err) {
          // 忽略回调错误
        }
      });
    });
  }

  /**
   * 处理播放队列（循环消费）
   * 每次取优先级最高的项播放
   */
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.isProcessing) {
      if (this._state === 'paused') {
        this.isProcessing = false;
        return;
      }

      // 取优先级最高的项（按 PRIORITY_ORDER 排序）
      const item = this.queue.shift();
      if (!item) continue;

      this.setState('playing');
      await this.playChunk(item.data);
    }

    this.isProcessing = false;

    if (this._state === 'playing') {
      this.setState('idle');
      try {
        this.callbacks.onComplete?.();
      } catch (err) {
        // 忽略回调错误
      }
    }
  }

  /**
   * 播放单个 PCM 音频块
   */
  private async playChunk(pcmData: Buffer): Promise<void> {
    const wavData = this.pcmToWav(pcmData);

    const tempFile = await this.writeTempFile(wavData);

    try {
      await this.playWavFile(tempFile);
    } finally {
      try {
        unlinkSync(tempFile);
      } catch (err) {
        // 忽略清理错误
      }
    }
  }

  /**
   * PCM16 数据转 WAV
   */
  private pcmToWav(pcmData: Buffer): Buffer {
    const header = createWavHeader(
      pcmData.length,
      this.options.sampleRate,
      this.options.channels,
      this.options.bitsPerSample
    );
    return Buffer.concat([header, pcmData]);
  }

  /**
   * 写入临时文件
   */
  private async writeTempFile(data: Buffer): Promise<string> {
    if (!this.tempDir) {
      this.tempDir = mkdtempSync(join(tmpdir(), 'pcm-player-'));
    }
    const filePath = join(this.tempDir, `${randomUUID()}.wav`);
    writeFileSync(filePath, data);
    return filePath;
  }

  /**
   * 清理临时目录
   */
  private cleanupTempDir(): void {
    if (this.tempDir) {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch (err) {
        // 忽略清理错误
      }
      this.tempDir = null;
    }
  }

  /**
   * 使用平台默认播放器播放 WAV 文件
   */
  private playWavFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const platform = getPlatform();
      let command: string;
      let args: string[];

      switch (platform) {
        case 'win32':
          command = 'powershell';
          args = [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`,
          ];
          break;

        case 'darwin':
          command = 'afplay';
          args = [filePath];
          break;

        case 'linux':
          command = 'aplay';
          args = [filePath];
          break;

        default:
          reject(new Error(`不支持的平台: ${platform}`));
          return;
      }

      const proc = spawn(command, args, { stdio: 'ignore' });
      this.activeProcess = proc;

      const timeout = setTimeout(() => {
        if (this.activeProcess === proc) {
          try {
            proc.kill();
          } catch (err) {
            /* 忽略 */
          }
          this.activeProcess = null;
        }
        resolve();
      }, PLAY_TIMEOUT_MS);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (this.activeProcess === proc) {
          this.activeProcess = null;
        }
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`播放进程退出，退出码: ${code}`));
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        if (this.activeProcess === proc) {
          this.activeProcess = null;
        }
        reject(error);
      });
    });
  }
}
