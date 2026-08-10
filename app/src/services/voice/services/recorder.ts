/**
 * Recorder
 * 录音模块
 *
 * 封装各平台的录音后端（ffmpeg / SoX / arecord / PowerShell），
 * 提供流式录音和文件录音两种模式。
 * 从 voiceService.ts 提取，聚焦于"如何录音"的执行逻辑。
 */

import { spawn, type ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import {
  RECORDING_SAMPLE_RATE,
  RECORDING_CHANNELS,
  RECORDING_BITS_PER_SAMPLE,
  hasCommand,
} from './recordingDetector';
import type { RecordingOptions, RecordingStateHandler } from '../models/types';

const logger = getLogger('voice:recorder');

/** 录音方法 */
export type RecordingMethod = 'ffmpeg' | 'sox' | 'arecord' | 'powershell';

/**
 * 录音设备错误
 * 用于区分"设备不可用"和"录音意外中断"两种场景
 */
export class DeviceError extends AppError {
  /** 录音工具名称 */
  readonly tool: string;
  /** 进程退出码 */
  readonly exitCode: number;
  /** stderr 原始内容 */
  readonly stderr: string;

  constructor(message: string, tool: string, exitCode: number, stderr: string) {
    super(message, ErrorCategory.RESOURCE, ErrorSeverity.HIGH, 'DEVICE_ERROR');
    this.name = 'DeviceError';
    this.tool = tool;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** 录音器配置 */
export interface RecorderConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  silenceThreshold?: string;
  silenceDuration?: string;
}

/**
 * 录音器
 *
 * 管理录音子进程的生命周期，支持流式输出和文件输出。
 * 不处理 VAD 或电平检测——这些由调用方（VoiceService）在回调中完成。
 */
export class Recorder {
  /** 当前活跃的子进程 */
  private process: ChildProcess | null = null;
  /** 录音器配置 */
  private config: RecorderConfig;

  /**
   * @param config 录音器配置
   */
  constructor(config: RecorderConfig) {
    this.config = config;
  }

  /** 当前是否正在录音 */
  get isActive(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * 停止录音（发送 SIGTERM）
   */
  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }
    this.process = null;
  }

  // ===========================================================
  // 流式录音（stdout pipe）
  // ===========================================================

  /**
   * 启动流式录音
   *
   * 音频数据通过 onData 回调实时返回，录音结束时调用 onEnd。
   *
   * @param method 录音方法
   * @param onData 音频数据回调
   * @param onEnd 录音结束回调
   * @param options 可选参数
   * @returns 是否成功启动
   */
  async startStream(
    method: RecordingMethod,
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): Promise<boolean> {
    this.stop();

    switch (method) {
      case 'ffmpeg':
        return this.startFFmpegStream(onData, onEnd, options);
      case 'sox':
        return this.startSoxStream(onData, onEnd, options);
      case 'arecord':
        return this.startArecordStream(onData, onEnd, options);
      case 'powershell':
        return this.startPowerShellStream(onData, onEnd, options);
      default:
        void handleError(new Error(`未知的录音方法: ${method}`), {
          module: 'services:voice:recorder',
          action: '未知录音方法',
        });
        return false;
    }
  }

  /**
   * 启动文件录音
   *
   * 录音结果保存到临时文件，返回文件路径。
   *
   * @param method 录音方法
   * @param options 录音选项
   * @param onState 状态回调
   * @returns 录音文件路径
   */
  async startFile(
    method: RecordingMethod,
    options: RecordingOptions = {},
    onState?: RecordingStateHandler
  ): Promise<string> {
    const outputFile = join(tmpdir(), `voice_input_${randomUUID()}.wav`);
    const maxSecs = options.maxDurationSecs ?? 30;

    onState?.('starting');

    switch (method) {
      case 'ffmpeg':
        await this.recordWithFFmpeg(outputFile, maxSecs, onState);
        break;
      case 'sox':
        await this.recordWithSox(outputFile, options, onState);
        break;
      case 'arecord':
        await this.recordWithArecord(outputFile, maxSecs, onState);
        break;
      case 'powershell':
        await this.recordWithPowerShell(outputFile, maxSecs, onState);
        break;
      default:
        throw new Error(`Recorder · 未知的录音方法: ${method}`);
    }

    onState?.('done');
    return outputFile;
  }

  // ===========================================================
  // FFmpeg 流式录音
  // ===========================================================

  /**
   * 枚举 Windows DirectShow 音频输入设备
   */
  private getFFmpegAudioDevice(): string | null {
    const { spawnSync } = require('child_process');
    const result = spawnSync(
      'ffmpeg',
      ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      }
    );

    const stderr = result.stderr?.toString() ?? '';
    const stdout = result.stdout?.toString() ?? '';
    const output = stderr || stdout;

    const audioDeviceMatch =
      output.match(/"([^"]+)"\s*\(audio\)/i) ??
      output.match(/"([^"]+)"\s*\(音频\)/i);

    if (audioDeviceMatch) {
      return audioDeviceMatch[1];
    }

    const lines = output.split('\n');
    for (const line of lines) {
      if (
        line.includes('audio') ||
        line.includes('音频') ||
        line.includes('麦克风') ||
        line.includes('Microphone')
      ) {
        const nameMatch = line.match(/"([^"]+)"/);
        if (nameMatch) return nameMatch[1];
      }
    }

    return null;
  }

  /**
   * FFmpeg 流式录音（Windows dshow → stdout）
   */
  private startFFmpegStream(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): Promise<boolean> {
    const maxSecs = options?.maxDurationSecs ?? 30;
    const device = this.getFFmpegAudioDevice();
    if (!device) {
      logger.warn('FFmpeg · 未找到音频输入设备，回退到 PowerShell');
      return this.startPowerShellStream(onData, onEnd, options);
    }

    const args = [
      '-f',
      'dshow',
      '-i',
      `audio=${device}`,
      '-acodec',
      'pcm_s16le',
      '-ar',
      String(this.config.sampleRate),
      '-ac',
      String(this.config.channels),
      '-t',
      String(maxSecs),
      '-f',
      'wav',
      '-',
    ];

    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.process = child;

      child.stdout?.on('data', (chunk: Buffer) => {
        onData(chunk);
      });
      child.stderr?.on('data', () => {});

      child.on('close', () => {
        this.process = null;
        onEnd();
      });

      child.on('error', (err) => {
        logger.warn('FFmpeg · 录音失败，回退到 PowerShell', {
          error: String(err),
        });
        this.process = null;
        this.startPowerShellStream(onData, onEnd, options)
          .then(resolve)
          .catch((psErr) => {
            logger.error('PowerShell 录音回退也失败', {
              error: String(psErr),
            });
            reject(
              new Error(
                `录音失败: FFmpeg(${String(err)}), PowerShell(${String(psErr)})`
              )
            );
          });
      });

      resolve(true);
    });
  }

  // ===========================================================
  // SoX 流式录音
  // ===========================================================

  /**
   * SoX rec 流式录音
   */
  private startSoxStream(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): boolean {
    const args = [
      '-q',
      '--buffer',
      '1024',
      '-t',
      'raw',
      '-r',
      String(this.config.sampleRate),
      '-e',
      'signed',
      '-b',
      String(this.config.bitDepth),
      '-c',
      String(this.config.channels),
      '-',
    ];

    const sd = options?.silenceDetection !== false;
    const threshold =
      options?.silenceThreshold ?? this.config.silenceThreshold ?? '3%';
    const duration =
      options?.silenceDurationSecs ?? this.config.silenceDuration ?? '2.0';

    if (sd) {
      args.push(
        'silence',
        '1',
        '0.1',
        String(threshold),
        '1',
        String(duration),
        String(threshold)
      );
    }

    const child = spawn('rec', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      onData(chunk);
    });
    child.stderr?.on('data', () => {});

    child.on('close', () => {
      this.process = null;
      onEnd();
    });

    child.on('error', (err) => {
      void handleError(err, {
        module: 'services:voice:recorder',
        action: 'SoX 录音失败',
      });
      this.process = null;
      onEnd();
    });

    return true;
  }

  // ===========================================================
  // arecord 流式录音
  // ===========================================================

  /**
   * arecord 流式录音（Linux ALSA）
   */
  private startArecordStream(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): boolean {
    const args = [
      '-f',
      'S16_LE',
      '-r',
      String(this.config.sampleRate),
      '-c',
      String(this.config.channels),
      '-t',
      'raw',
    ];

    if (options?.device) {
      args.push('-D', options.device);
    }

    args.push('-q', '-');

    const child = spawn('arecord', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      onData(chunk);
    });
    child.stderr?.on('data', () => {});

    child.on('close', () => {
      this.process = null;
      onEnd();
    });

    child.on('error', (err) => {
      void handleError(err, {
        module: 'services:voice:recorder',
        action: 'arecord 录音失败',
      });
      this.process = null;
      onEnd();
    });

    return true;
  }

  // ===========================================================
  // PowerShell 流式录音
  // ===========================================================

  /**
   * 将秒数转换为 SoundRecorder.exe 所需的 HH:mm:ss 格式
   */
  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * PowerShell 流式录音（Windows 终极回退）
   *
   * 先尝试 SoundRecorder.exe 写文件，失败后用 PowerShell 直接输出 WAV 到 stdout。
   */
  private async startPowerShellStream(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): Promise<boolean> {
    const maxSecs = options?.maxDurationSecs ?? 30;
    const outputFile = join(tmpdir(), `voice_input_${randomUUID()}.wav`);
    const durationStr = this.formatDuration(maxSecs);

    // 先尝试 SoundRecorder.exe（Windows 内置）
    try {
      const sr = spawn(
        'SoundRecorder',
        ['/FILE', outputFile, '/DURATION', durationStr, '/OVERWRITE'],
        { stdio: 'ignore', timeout: (maxSecs + 5) * 1000 }
      );

      await new Promise<void>((resolve, reject) => {
        sr.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`SoundRecorder exit code: ${code}`));
        });
        sr.on('error', (err) => reject(err));
      });

      const { readFile } = require('fs/promises');
      const data = await readFile(outputFile);
      onData(data);
      // @ignore-catch — 录制失败时清理输出文件，best-effort非关键
      unlink(outputFile).catch(() => {});
      return true;
    } catch (err) {
      logger.warn(
        'Recorder · SoundRecorder.exe 失败，回退到 PowerShell 静音录音',
        {
          error: String(err),
        }
      );
    }

    // PowerShell 直接输出 WAV 到 stdout
    const psScript = `
$duration = [TimeSpan]::FromSeconds(${maxSecs})
$sampleRate = ${this.config.sampleRate}
$channels = ${this.config.channels}
$bitsPerSample = ${this.config.bitDepth}
$blockAlign = [int](($channels * $bitsPerSample) / 8)
$bytesPerSec = [int]($sampleRate * $blockAlign)
$totalSamples = [int]($sampleRate * $channels * $duration.TotalSeconds)
$dataSize = $totalSamples * $blockAlign

Add-Type -AssemblyName System.Windows.Forms
$source = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($source)
$waveFormat = New-Object System.Windows.Forms.WaveFormat
$waveFormat.samplesPerSecond = $sampleRate
$waveFormat.channels = $channels
$waveFormat.bitsPerSample = $bitsPerSample
$waveFormat.blockAlign = $blockAlign
$waveFormat.averageBytesPerSecond = $bytesPerSec

$writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
$writer.Write([int](36 + $dataSize))
$writer.Write([Text.Encoding]::ASCII.GetBytes('WAVE'))
$writer.Write([Text.Encoding]::ASCII.GetBytes('fmt '))
$writer.Write([int](16))
$writer.Write([int](1))
$writer.Write([int]($channels))
$writer.Write([int]($sampleRate))
$writer.Write([int]($bytesPerSec))
$writer.Write([int]($blockAlign))
$writer.Write([int]($bitsPerSample))
$writer.Write([Text.Encoding]::ASCII.GetBytes('data'))
$writer.Write([int]($dataSize))
$startTime = [DateTime]::UtcNow
while (([DateTime]::UtcNow - $startTime).TotalSeconds -lt $duration.TotalSeconds) {
  Start-Sleep -Milliseconds 50
}
$writer.Close()
$bytes = $source.ToArray()
$source.Close()
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Close()
`;

    return new Promise((resolve) => {
      const child = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      this.process = child;

      const stdoutChunks: Buffer[] = [];
      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.on('data', () => {});

      child.on('close', () => {
        this.process = null;
        if (stdoutChunks.length > 0) {
          onData(Buffer.concat(stdoutChunks));
        }
        onEnd();
      });

      child.on('error', (err) => {
        void handleError(err, {
          module: 'services:voice:recorder',
          action: 'PowerShell 录音失败',
        });
        this.process = null;
        onEnd();
      });

      resolve(true);
    });
  }

  // ===========================================================
  // 文件录音（各后端实现）
  // ===========================================================

  /**
   * FFmpeg 录音到文件
   */
  private recordWithFFmpeg(
    outputFile: string,
    maxSecs: number,
    onState?: RecordingStateHandler
  ): Promise<void> {
    const device = this.getFFmpegAudioDevice();

    return new Promise((resolve, reject) => {
      if (!device) {
        logger.warn('Recorder · FFmpeg 未找到音频输入设备，回退到 PowerShell');
        this.recordWithPowerShell(outputFile, maxSecs, onState)
          .then(resolve)
          .catch(reject);
        return;
      }

      const args = [
        '-f',
        'dshow',
        '-i',
        `audio=${device}`,
        '-acodec',
        'pcm_s16le',
        '-ar',
        String(this.config.sampleRate),
        '-ac',
        String(this.config.channels),
        '-t',
        String(maxSecs),
        '-y',
        outputFile,
      ];

      const child = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      this.process = child;

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        this.process = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg failed (code ${code}): ${stderr.trim()}`));
        }
      });

      child.on('error', (err) => {
        this.process = null;
        reject(new Error(`Failed to start ffmpeg: ${err.message}`));
      });
    });
  }

  /**
   * SoX 录音到文件
   */
  private recordWithSox(
    outputFile: string,
    options: RecordingOptions,
    onState?: RecordingStateHandler
  ): Promise<void> {
    const maxSecs = options.maxDurationSecs ?? 30;
    const threshold =
      options.silenceThreshold ?? this.config.silenceThreshold ?? '3%';

    return new Promise((resolve, reject) => {
      const args = [
        '-q',
        '-r',
        String(this.config.sampleRate),
        '-e',
        'signed',
        '-b',
        String(this.config.bitDepth),
        '-c',
        String(this.config.channels),
        '-t',
        'wav',
        '-d',
        String(maxSecs),
        'silence',
        '1',
        '0.1',
        String(threshold),
        '1',
        String(
          options.silenceDurationSecs ?? this.config.silenceDuration ?? '2.0'
        ),
        String(threshold),
        outputFile,
      ];

      const child = spawn('sox', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      this.process = child;

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        this.process = null;
        if (code === 0) {
          resolve();
        } else if (code !== null) {
          // 分类设备级错误 vs 录音中断
          const trimmedStderr = stderr.trim();
          if (this.isSoxDeviceError(trimmedStderr)) {
            reject(
              new DeviceError(
                'SoX 无法打开默认音频设备',
                'sox',
                code,
                trimmedStderr
              )
            );
          } else {
            reject(new Error(`sox failed (code ${code}): ${trimmedStderr}`));
          }
        }
      });

      child.on('error', (err) => {
        this.process = null;
        reject(new Error(`Failed to start sox: ${err.message}`));
      });
    });
  }

  /**
   * 判断 SoX stderr 是否包含设备不可用的错误
   */
  private isSoxDeviceError(stderr: string): boolean {
    const deviceErrors = [
      'no default audio device',
      'Failed to open audio device',
      "can't open input file",
      'AUDIO_open_default_recording',
      'Failed opening default audio',
    ];
    return deviceErrors.some((msg) =>
      stderr.toLowerCase().includes(msg.toLowerCase())
    );
  }

  /**
   * arecord 录音到文件
   */
  private recordWithArecord(
    outputFile: string,
    maxSecs: number,
    onState?: RecordingStateHandler
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-f',
        'S16_LE',
        '-r',
        String(this.config.sampleRate),
        '-c',
        String(this.config.channels),
        '-t',
        'wav',
        '-d',
        String(maxSecs),
        '-q',
        outputFile,
      ];

      const child = spawn('arecord', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      this.process = child;

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        this.process = null;
        if (code === 0) {
          resolve();
        } else if (code !== null) {
          const trimmedStderr = stderr.trim();
          if (this.isArecordDeviceError(trimmedStderr)) {
            reject(
              new DeviceError(
                'arecord 无法打开音频设备',
                'arecord',
                code,
                trimmedStderr
              )
            );
          } else {
            reject(
              new Error(`arecord failed (code ${code}): ${trimmedStderr}`)
            );
          }
        }
      });

      child.on('error', (err) => {
        this.process = null;
        reject(new Error(`Failed to start arecord: ${err.message}`));
      });
    });
  }

  /**
   * 判断 arecord stderr 是否包含设备不可用的错误
   */
  private isArecordDeviceError(stderr: string): boolean {
    const deviceErrors = [
      'no such device',
      'device busy',
      'cannot open',
      'no recording device',
      'pcm_open',
      'alsa: cannot open',
    ];
    return deviceErrors.some((msg) =>
      stderr.toLowerCase().includes(msg.toLowerCase())
    );
  }

  /**
   * PowerShell（SoundRecorder）录音到文件
   */
  private recordWithPowerShell(
    outputFile: string,
    maxSecs: number,
    onState?: RecordingStateHandler
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const durationStr = this.formatDuration(maxSecs);

      const child = spawn(
        'SoundRecorder',
        ['/FILE', outputFile, '/DURATION', durationStr, '/OVERWRITE'],
        { stdio: 'ignore', timeout: (maxSecs + 5) * 1000 }
      );
      this.process = child;

      child.on('close', (code) => {
        this.process = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SoundRecorder failed (code ${code})`));
        }
      });

      child.on('error', (err) => {
        this.process = null;
        reject(new Error(`Failed to start SoundRecorder: ${err.message}`));
      });
    });
  }
}
