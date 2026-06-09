/**
 * 语音服务
 * 提供语音输入和输出功能
 *
 * 统一合并自 voice.ts（录音功能）、VoiceService.ts（事件系统）、voiceService.ts（类封装）
 */

import { type ChildProcess, spawn, spawnSync } from 'child_process';
import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getPlatform } from '@modules/utils/platform';
import { Logger } from '@modules/monitoring/logs/Logger';
import { isEnvTruthy } from '@modules/utils/envUtils';
import { configManager } from '@modules/config';

import type {
  RecordingAvailability,
  VoiceDependencies,
  RecordingOptions,
  RecordingResult,
  RecordingStateHandler,
  SpeechRecognitionResult,
  VoiceInputResult,
  VoiceOutputOptions,
  VoiceServiceConfig,
  VoiceEventType,
  VoiceEvent,
  VoiceEventListener,
  STTResult,
  STTTranscribeOptions,
} from '../models/types';

import { VadDetector } from './vadDetector';
import { EnvironmentDetector } from './environmentDetector';
import { TTSRegistry } from './ttsProvider';
import { STTRegistry } from './sttRegistry';
import { TTSPersonaManager } from './ttsPersonaManager';
import { AudioLevelMeter } from './audioLevelMeter';
import {
  AudioFormatConverter,
  isFFmpegAvailable,
  getFormatInfo,
} from './audioFormatConverter';
import type { AudioFormat } from './audioFormatConverter';

const logger = new Logger({});

// 常量定义
const RECORDING_SAMPLE_RATE = 16000;
const RECORDING_CHANNELS = 1;
const RECORDING_BITS_PER_SAMPLE = 16;
const SILENCE_DURATION_SECS = '2.0';
const SILENCE_THRESHOLD = '3%';

// 活跃的录音进程
let activeRecorder: ChildProcess | null = null;

// ---------------------------------------------------------------
// 工具函数（文件级，不导出）
// ---------------------------------------------------------------

/**
 * 检查命令是否存在
 */
function hasCommand(cmd: string): boolean {
  const isWindows = process.platform === 'win32';
  const searchCmd = isWindows ? 'where' : 'which';
  const result = spawnSync(searchCmd, [cmd], {
    stdio: 'ignore',
    timeout: 3000,
  });
  return result.error === undefined;
}

/**
 * 探测 arecord 是否可用
 */
type ArecordProbeResult = { ok: boolean; stderr: string };
let arecordProbe: Promise<ArecordProbeResult> | null = null;

function probeArecord(): Promise<ArecordProbeResult> {
  arecordProbe ??= new Promise((resolve) => {
    const child = spawn(
      'arecord',
      [
        '-f',
        'S16_LE',
        '-r',
        String(RECORDING_SAMPLE_RATE),
        '-c',
        String(RECORDING_CHANNELS),
        '-t',
        'raw',
        '/dev/null',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(
      (c: ChildProcess, r: (v: ArecordProbeResult) => void) => {
        c.kill('SIGTERM');
        r({ ok: true, stderr: '' });
      },
      150,
      child,
      resolve
    );
    child.once('close', (code) => {
      clearTimeout(timer);
      void resolve({ ok: code === 0, stderr: stderr.trim() });
    });
    child.once('error', () => {
      clearTimeout(timer);
      void resolve({ ok: false, stderr: 'arecord: command not found' });
    });
  });
  return arecordProbe;
}

/**
 * 检查 Linux 是否有 ALSA 声卡
 */
let linuxAlsaCardsMemo: Promise<boolean> | null = null;

function linuxHasAlsaCards(): Promise<boolean> {
  linuxAlsaCardsMemo ??= readFile('/proc/asound/cards', 'utf8').then(
    (cards) => {
      const c = cards.trim();
      return c !== '' && !c.includes('no soundcards');
    },
    () => false
  );
  return linuxAlsaCardsMemo;
}

/**
 * 检测包管理器
 */
type PackageManagerInfo = {
  cmd: string;
  args: string[];
  displayCommand: string;
};

function detectPackageManager(): PackageManagerInfo | null {
  if (process.platform === 'darwin') {
    if (hasCommand('brew')) {
      return {
        cmd: 'brew',
        args: ['install', 'sox'],
        displayCommand: 'brew install sox',
      };
    }
    return null;
  }

  if (process.platform === 'linux') {
    if (hasCommand('apt-get')) {
      return {
        cmd: 'sudo',
        args: ['apt-get', 'install', '-y', 'sox'],
        displayCommand: 'sudo apt-get install sox',
      };
    }
    if (hasCommand('dnf')) {
      return {
        cmd: 'sudo',
        args: ['dnf', 'install', '-y', 'sox'],
        displayCommand: 'sudo dnf install sox',
      };
    }
    if (hasCommand('pacman')) {
      return {
        cmd: 'sudo',
        args: ['pacman', '-S', '--noconfirm', 'sox'],
        displayCommand: 'sudo pacman -S sox',
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------
// 语音服务类
// ---------------------------------------------------------------

export class VoiceService {
  private config: VoiceServiceConfig;
  private listeners: Map<VoiceEventType, Set<VoiceEventListener>> = new Map();
  private isRecording: boolean = false;
  private isSpeaking: boolean = false;
  /** 音频电平表（录音时实时测量音量） */
  private levelMeter: AudioLevelMeter;
  /** 当前电平归一化值（0-1） */
  private currentLevel: number = 0;

  /**
   * @param config 语音服务配置
   */
  constructor(config: VoiceServiceConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate || RECORDING_SAMPLE_RATE,
      channels: config.channels || RECORDING_CHANNELS,
      bitDepth: config.bitDepth || RECORDING_BITS_PER_SAMPLE,
      silenceThreshold: config.silenceThreshold ?? SILENCE_THRESHOLD,
      silenceDuration: config.silenceDuration ?? SILENCE_DURATION_SECS,
      language: config.language || 'zh-CN',
    };

    this.levelMeter = new AudioLevelMeter(
      this.config.sampleRate ?? RECORDING_SAMPLE_RATE
    );
  }

  // ===========================================================
  // 配置
  // ===========================================================

  /**
   * 获取配置
   */
  getConfig(): VoiceServiceConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   * @param config 部分配置
   */
  updateConfig(config: Partial<VoiceServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ===========================================================
  // 事件系统
  // ===========================================================

  /**
   * 添加事件监听器
   * @param type 事件类型
   * @param listener 监听器
   */
  addEventListener(type: VoiceEventType, listener: VoiceEventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  /**
   * 移除事件监听器
   * @param type 事件类型
   * @param listener 监听器
   */
  removeEventListener(
    type: VoiceEventType,
    listener: VoiceEventListener
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  /**
   * 触发事件
   * @param type 事件类型
   * @param data 事件数据
   */
  private emit(type: VoiceEventType, data?: unknown): void {
    const event: VoiceEvent = {
      type,
      data,
      timestamp: Date.now(),
    };
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  /**
   * 录音中是否
   */
  isRecordingActive(): boolean {
    return this.isRecording;
  }

  /**
   * 是否正在说话
   */
  isSpeakingActive(): boolean {
    return this.isSpeaking;
  }

  // ===========================================================
  // 依赖检查与环境检测
  // ===========================================================

  /**
   * 检查语音依赖
   *
   * 返回各平台可用的录音方法和缺失的依赖信息。
   * 检测链：Windows → PowerShell（默认）；macOS → SoX；Linux → arecord → SoX
   */
  async checkVoiceDependencies(): Promise<VoiceDependencies> {
    const missing: string[] = [];
    let method: string | null = null;

    if (process.platform === 'win32') {
      if (hasCommand('sox') || hasCommand('sox.exe')) {
        method = 'sox';
      } else {
        method = 'powershell';
      }
      return { available: true, missing: [], installCommand: null, method };
    }

    if (process.platform === 'darwin') {
      if (hasCommand('sox')) {
        method = 'sox';
      } else {
        missing.push('sox');
        return {
          available: false,
          missing,
          installCommand: hasCommand('brew')
            ? 'brew install sox'
            : 'Install SoX from https://sox.sourceforge.net/',
          method: null,
        };
      }
      return { available: true, missing: [], installCommand: null, method };
    }

    if (process.platform === 'linux') {
      if (hasCommand('sox')) {
        method = 'sox';
      } else if (hasCommand('arecord')) {
        method = 'arecord';
      } else {
        missing.push('sox or arecord');
        let installCmd: string | null = null;
        if (hasCommand('apt-get')) {
          installCmd = 'sudo apt-get install -y sox';
        } else if (hasCommand('dnf')) {
          installCmd = 'sudo dnf install -y sox';
        } else if (hasCommand('pacman')) {
          installCmd = 'sudo pacman -S sox';
        }
        return {
          available: false,
          missing,
          installCommand: installCmd,
          method: null,
        };
      }
      return { available: true, missing: [], installCommand: null, method };
    }

    return {
      available: false,
      missing: ['unsupported platform'],
      installCommand: null,
      method: null,
    };
  }

  /**
   * 检查录音可用性
   */
  async checkRecordingAvailability(): Promise<RecordingAvailability> {
    if (isEnvTruthy(configManager.env('Liri_REMOTE'))) {
      return {
        available: false,
        reason:
          'Voice mode requires microphone access, but no audio device is available in this environment.\n\nTo use voice mode, run Liri locally instead.',
      };
    }

    const dependencies = await this.checkVoiceDependencies();
    if (!dependencies.available) {
      return {
        available: false,
        reason:
          dependencies.missing.join(', ') +
          (dependencies.installCommand
            ? `\n\nInstall with: ${dependencies.installCommand}`
            : ''),
      };
    }

    if (process.platform === 'linux' && dependencies.method === 'arecord') {
      const probe = await probeArecord();
      if (!probe.ok) {
        if (getPlatform() === 'wsl') {
          return {
            available: false,
            reason:
              'Voice mode could not access an audio device in WSL.\n\nWSL2 with WSLg (Windows 11) provides audio via PulseAudio — if you are on Windows 10 or WSL1, run Liri in native Windows instead.',
          };
        }
      }
    }

    return { available: true, reason: null };
  }

  // ===========================================================
  // 录音
  // ===========================================================

  /**
   * 将 PCM Int16 Buffer 转换为归一化 Float64Array
   * @param buffer PCM Int16 音频数据
   */
  private pcm16BufferToSamples(buffer: Buffer): Float64Array {
    const samples = new Float64Array(buffer.length / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = buffer.readInt16LE(i * 2) / 32768;
    }
    return samples;
  }

  /**
   * 开始录音
   *
   * 自动选择可用的录音工具，支持 SoX、arecord、PowerShell 三种方式。
   * 录音数据通过 onData 回调实时返回，录音结束时触发 onEnd。
   *
   * 对 arecord（无内置静音检测）自动添加 VAD 静音检测和自动停止；
   * 对所有流式录音方法自动运行环境检测以适配 VAD 参数。
   *
   * @param onData 音频数据回调
   * @param onEnd 录音结束回调
   * @param options 录音选项
   */
  async startRecording(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): Promise<boolean> {
    this.stopRecording();

    if (this.isRecording) {
      return false;
    }

    const availability = await this.checkRecordingAvailability();
    if (!availability.available) {
      return false;
    }

    const deps = await this.checkVoiceDependencies();
    this.isRecording = true;
    this.emit('start');

    // 重置电平表
    this.levelMeter.reset();
    this.currentLevel = 0;

    // 创建环境检测器与 VAD（arecord 无内置静音检测，需要软件 VAD）
    const sampleRate = this.config.sampleRate ?? RECORDING_SAMPLE_RATE;
    const envDetector = new EnvironmentDetector({ sampleRate });
    const useVad = deps.method === 'arecord';
    let vad: VadDetector | null = null;
    let wasSpeaking = false;

    if (useVad) {
      vad = new VadDetector(sampleRate, {
        minSpeechDurationMs: 150,
        silenceHoldMs: 2000,
      });
    }

    /**
     * 包装 onData 回调，集成环境检测、VAD 静音检测和电平测量
     */
    const wrappedOnData = (chunk: Buffer) => {
      const samples = this.pcm16BufferToSamples(chunk);

      // 电平表处理（实时计算录音音量）
      const levelResult = this.levelMeter.processFloat64(samples);
      if (levelResult) {
        this.currentLevel = levelResult.normalized;
      }

      if (!envDetector.isComplete() || (vad && !wasSpeaking)) {
        // 环境检测（录音初期自动分析背景噪声）
        if (!envDetector.isComplete()) {
          const envResult = envDetector.process(samples);
          if (envResult) {
            logger.info('Environment detected', {
              environment: envResult.environment,
              confidence: envResult.confidence,
            });
            vad?.configure(envResult.recommendedVadOptions);
          }
        }

        // VAD 自动停止（仅 arecord，无内置静音检测）
        if (vad) {
          const vadResult = vad.process(samples);
          if (wasSpeaking && !vadResult.isSpeech) {
            logger.info('VAD silence detected, stopping recording');
            this.stopRecording();
            onEnd();
            return;
          }
          if (vadResult.isSpeech) {
            wasSpeaking = true;
          }
        }
      }

      onData(chunk);
    };

    let started = false;

    switch (deps.method) {
      case 'sox':
        started = this.startSoxRecording(wrappedOnData, onEnd, options);
        break;
      case 'arecord':
        started = this.startArecordRecording(wrappedOnData, onEnd, options);
        break;
      case 'powershell':
        started = await this.startPowerShellRecording(onData, onEnd, options);
        break;
      default:
        this.isRecording = false;
        return false;
    }

    if (!started) {
      this.isRecording = false;
    }
    return started;
  }

  /**
   * 停止录音
   */
  stopRecording(): void {
    if (!this.isRecording) {
      return;
    }

    if (activeRecorder) {
      activeRecorder.kill('SIGTERM');
      activeRecorder = null;
    }

    this.isRecording = false;
    this.emit('stop');
  }

  /**
   * 使用 SoX rec 开始录音
   */
  private startSoxRecording(
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
      options?.silenceThreshold ??
      this.config.silenceThreshold ??
      SILENCE_THRESHOLD;
    const duration =
      options?.silenceDurationSecs ??
      this.config.silenceDuration ??
      SILENCE_DURATION_SECS;

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

    activeRecorder = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      onData(chunk);
    });

    child.stderr?.on('data', () => {});

    child.on('close', () => {
      activeRecorder = null;
      this.isRecording = false;
      this.emit('stop');
      onEnd();
    });

    child.on('error', (err) => {
      logger.error('SoX recording failed', { error: String(err) });
      activeRecorder = null;
      this.isRecording = false;
      this.emit('error', { error: err.message });
      onEnd();
    });

    return true;
  }

  /**
   * 使用 arecord 开始录音（Linux ALSA）
   */
  private startArecordRecording(
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

    activeRecorder = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      onData(chunk);
    });

    child.stderr?.on('data', () => {});

    child.on('close', () => {
      activeRecorder = null;
      this.isRecording = false;
      this.emit('stop');
      onEnd();
    });

    child.on('error', (err) => {
      logger.error('arecord recording failed', { error: String(err) });
      activeRecorder = null;
      this.isRecording = false;
      this.emit('error', { error: err.message });
      onEnd();
    });

    return true;
  }

  /**
   * 使用 PowerShell 开始录音（Windows）
   */
  private async startPowerShellRecording(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): Promise<boolean> {
    const maxSecs = options?.maxDurationSecs ?? 30;

    // 录音到一个临时 WAV 文件，再以流方式读取
    const outputFile = join(tmpdir(), `voice_input_${randomUUID()}.wav`);

    const psScript = `
$output = '${outputFile.replace(/'/g, "''")}'
$duration = [TimeSpan]::FromSeconds(${maxSecs})
$sampleRate = ${this.config.sampleRate ?? RECORDING_SAMPLE_RATE}
$channels = ${this.config.channels ?? RECORDING_CHANNELS}
$bitsPerSample = ${this.config.bitDepth ?? RECORDING_BITS_PER_SAMPLE}
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

# WAV header (44 bytes)
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
[System.IO.File]::WriteAllBytes($output, $source.ToArray())
$source.Close()
Write-Host "RECORDING_DONE:$output"
`;

    return new Promise((resolve) => {
      const child = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      activeRecorder = child;

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const doneMatch = text.match(/^RECORDING_DONE:(.+)$/m);
        if (doneMatch) {
          // 录音完成，读取文件内容
          readFile(doneMatch[1])
            .then((data) => {
              onData(data);
              // 清理临时文件
              unlink(doneMatch[1]).catch(() => {});
            })
            .catch((err) => {
              logger.error('Failed to read PowerShell recording', {
                error: String(err),
              });
            });
        } else {
          onData(chunk);
        }
      });

      child.stderr?.on('data', () => {});

      child.on('close', () => {
        activeRecorder = null;
        this.isRecording = false;
        this.emit('stop');
        onEnd();
      });

      child.on('error', (err) => {
        logger.error('PowerShell recording failed', { error: String(err) });
        activeRecorder = null;
        this.isRecording = false;
        this.emit('error', { error: err.message });
        onEnd();
      });

      resolve(true);
    });
  }

  /**
   * 开始文件级录音（保存到临时文件，适用于 CLI 命令）
   *
   * @param options 录音选项
   * @param onState 状态回调
   * @returns 录音文件路径
   */
  async startFileRecording(
    options: RecordingOptions = {},
    onState?: RecordingStateHandler
  ): Promise<string> {
    const deps = await this.checkVoiceDependencies();
    if (!deps.available) {
      throw new Error(
        `No recording tool available. Missing: ${deps.missing.join(', ')}. ` +
          `Install: ${deps.installCommand ?? 'See platform documentation'}`
      );
    }

    const outputFile = join(tmpdir(), `voice_input_${randomUUID()}.wav`);
    onState?.('starting');

    const maxSecs = options.maxDurationSecs ?? 30;

    switch (deps.method) {
      case 'sox': {
        await this.recordWithSox(outputFile, options, onState);
        break;
      }
      case 'arecord': {
        await this.recordWithArecord(outputFile, maxSecs, onState);
        break;
      }
      case 'powershell': {
        await this.recordWithPowerShell(outputFile, maxSecs, onState);
        break;
      }
      default:
        throw new Error(`Unknown recording method: ${deps.method}`);
    }

    onState?.('done');
    return outputFile;
  }

  /**
   * SoX 录音到文件
   */
  private recordWithSox(
    outputFile: string,
    options: RecordingOptions,
    onState?: RecordingStateHandler
  ): Promise<void> {
    const maxSecs = options.maxDurationSecs;
    return new Promise((resolve, reject) => {
      const args = [
        '-r',
        String(this.config.sampleRate),
        '-c',
        String(this.config.channels),
        '-b',
        String(this.config.bitDepth),
        '-e',
        'signed-integer',
      ];

      if (options.device) {
        args.push('-d', options.device);
      } else {
        args.push('-d');
      }

      const threshold =
        options?.silenceThreshold ??
        this.config.silenceThreshold ??
        SILENCE_THRESHOLD;
      const duration =
        options?.silenceDurationSecs ??
        this.config.silenceDuration ??
        SILENCE_DURATION_SECS;

      if (duration && threshold) {
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

      if (maxSecs) {
        args.push(outputFile, 'trim', '0', String(maxSecs));
      } else {
        args.push(outputFile);
      }

      const child = spawn('sox', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`sox failed (code ${code}): ${stderr.trim()}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start sox: ${err.message}`));
      });

      onState?.('recording');
    });
  }

  /**
   * arecord 录音到文件
   */
  private recordWithArecord(
    outputFile: string,
    maxDurationSecs: number,
    onState?: RecordingStateHandler
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-r',
        String(this.config.sampleRate),
        '-c',
        String(this.config.channels),
        '-f',
        'S16_LE',
        '-t',
        'wav',
        '-d',
        String(maxDurationSecs),
        outputFile,
      ];

      const child = spawn('arecord', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`arecord failed (code ${code}): ${stderr.trim()}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start arecord: ${err.message}`));
      });

      onState?.('recording');
    });
  }

  /**
   * PowerShell 录音到文件
   */
  private recordWithPowerShell(
    outputFile: string,
    maxDurationSecs: number,
    onState?: RecordingStateHandler
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const psScript = `
$output = '${outputFile.replace(/'/g, "''")}'
$duration = [TimeSpan]::FromSeconds(${maxDurationSecs})
$sampleRate = ${this.config.sampleRate ?? RECORDING_SAMPLE_RATE}
$channels = ${this.config.channels ?? RECORDING_CHANNELS}
$bitsPerSample = ${this.config.bitDepth ?? RECORDING_BITS_PER_SAMPLE}
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
[System.IO.File]::WriteAllBytes($output, $source.ToArray())
$source.Close()
`;

      const child = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `PowerShell recording failed (code ${code}): ${stderr.trim()}`
            )
          );
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start PowerShell: ${err.message}`));
      });

      onState?.('recording');
    });
  }

  // ===========================================================
  // 录音文件管理
  // ===========================================================

  /**
   * 读取录音文件
   * @param filePath 录音文件路径
   */
  async getRecording(filePath: string): Promise<RecordingResult> {
    if (!existsSync(filePath)) {
      throw new Error(`Recording file not found: ${filePath}`);
    }

    const stat = await import('fs/promises').then((fs) => fs.stat(filePath));

    return {
      filePath,
      durationMs: 0,
      sampleRate: this.config.sampleRate ?? RECORDING_SAMPLE_RATE,
      format: 'wav',
    };
  }

  /**
   * 清除录音文件
   * @param filePath 录音文件路径
   */
  async cleanupRecording(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // 文件不存在时忽略
    }
  }

  // ===========================================================
  // 语音识别
  // ===========================================================

  /**
   * 语音识别（将音频转换为文本）
   * 通过 STTRegistry 选择可用的 STT 提供者执行转录。
   * @param audioData 音频数据
   * @param options 转录选项
   */
  async recognizeSpeech(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<SpeechRecognitionResult | null> {
    const result: STTResult = await STTRegistry.transcribe(audioData, {
      ...options,
      language:
        options?.language || this.config.sttLanguage || this.config.language,
      keyterms: options?.keyterms || this.config.sttKeyterms,
    });

    if (!result.text) {
      return null;
    }

    return {
      text: result.text,
      confidence: result.confidence,
    };
  }

  /**
   * 语音识别（VoiceService.ts 风格）
   * @param audioData 音频数据
   */
  async recognize(audioData: Buffer): Promise<VoiceInputResult> {
    const result: STTResult = await STTRegistry.transcribe(audioData, {
      language: this.config.sttLanguage || this.config.language,
      keyterms: this.config.sttKeyterms,
    });

    return {
      text: result.text || '',
      confidence: result.confidence,
      duration: result.duration || 0,
    };
  }

  // ===========================================================
  // 语音合成
  // ===========================================================

  /**
   * 语音合成（将文本转换为语音 Buffer）
   *
   * 默认返回 TTS 提供者的原始音频数据。
   * 如果指定 targetFormat 且 ffmpeg 可用，自动进行格式转换。
   *
   * @param text 文本
   * @param targetFormat 目标音频格式（可选，不指定则返回原始数据）
   */
  async synthesizeSpeech(
    text: string,
    targetFormat?: AudioFormat
  ): Promise<Buffer | null> {
    const result = await TTSRegistry.speak({ text });

    if (!result.success || !result.audioData) {
      return null;
    }

    // 不需要格式转换，直接返回原始音频数据
    if (!targetFormat || targetFormat === 'wav') {
      return result.audioData;
    }

    // 需要格式转换但 ffmpeg 不可用，降级返回原始数据
    if (!isFFmpegAvailable()) {
      logger.warn('synthesizeSpeech · ffmpeg 不可用，返回原始音频');
      return result.audioData;
    }

    const ext = getFormatInfo(targetFormat).extension;
    const tmpInput = join(tmpdir(), `tts_raw_${randomUUID()}.bin`);
    const tmpOutput = join(tmpdir(), `tts_conv_${randomUUID()}${ext}`);

    try {
      await writeFile(tmpInput, result.audioData);

      const convResult = AudioFormatConverter.convert({
        inputPath: tmpInput,
        outputPath: tmpOutput,
        targetFormat,
      });

      if (convResult.success && convResult.outputPath) {
        return await readFile(convResult.outputPath);
      }

      // 转换失败，降级返回原始数据
      return result.audioData;
    } catch (error) {
      logger.error('synthesizeSpeech · 格式转换异常', { error });
      return result.audioData;
    } finally {
      try {
        await unlink(tmpInput);
      } catch {
        /* ignore */
      }
      try {
        await unlink(tmpOutput);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 语音合成并播放
   *
   * 支持通过 personaId 指定人设，人设中的 voice/speed 可作为默认值，
   * 被 options 中的显式 voice/speed 覆盖。
   *
   * @param options 语音输出选项
   */
  async speak(options: VoiceOutputOptions): Promise<void> {
    this.isSpeaking = true;
    this.emit('start');

    // 解析人设配置（如果指定了 personaId）
    let resolvedVoice = options.voice;
    let resolvedSpeed = options.speed;
    let resolvedProvider: string | undefined;

    if (options.personaId) {
      const persona = TTSPersonaManager.get(options.personaId);
      if (persona) {
        resolvedVoice = options.voice ?? persona.voice;
        resolvedSpeed = options.speed ?? persona.speed;
        resolvedProvider = persona.provider;
      } else {
        logger.warn('VoiceService · 人设不存在', {
          personaId: options.personaId,
        });
      }
    }

    const result = await TTSRegistry.speak(
      {
        text: options.text,
        voice: resolvedVoice,
        speed: resolvedSpeed,
      },
      resolvedProvider
    );

    if (!result.success) {
      this.isSpeaking = false;
      this.emit('error', { error: result.error });
      return;
    }

    this.isSpeaking = false;
    this.emit('stop');
  }

  /**
   * 停止语音输出
   */
  stopSpeaking(): void {
    if (!this.isSpeaking) {
      return;
    }
    TTSRegistry.stopAll();
    this.isSpeaking = false;
    this.emit('stop');
  }

  // ===========================================================
  // 辅助功能
  // ===========================================================

  /**
   * 获取当前音量级别（归一化值 0-1）
   *
   * 录音时实时从 AudioLevelMeter 读取；非录音状态返回 0。
   */
  getVolumeLevel(): number {
    return this.currentLevel;
  }

  /**
   * 获取支持的语言
   */
  getSupportedLanguages(): Array<{ code: string; name: string }> {
    return [
      { code: 'zh-CN', name: 'Chinese (Mandarin)' },
      { code: 'en-US', name: 'English (US)' },
      { code: 'en-GB', name: 'English (UK)' },
      { code: 'ja-JP', name: 'Japanese' },
      { code: 'ko-KR', name: 'Korean' },
      { code: 'fr-FR', name: 'French' },
      { code: 'de-DE', name: 'German' },
      { code: 'es-ES', name: 'Spanish' },
    ];
  }

  // ===========================================================
  // 生命周期
  // ===========================================================

  /**
   * 销毁服务，释放所有资源
   */
  destroy(): void {
    this.stopRecording();
    this.stopSpeaking();
    this.listeners.clear();
  }
}

/**
 * 创建语音服务实例
 * @param config 语音服务配置
 */
export function createVoiceService(
  config: VoiceServiceConfig = {}
): VoiceService {
  return new VoiceService(config);
}

// 导出默认服务实例
const voiceService = createVoiceService();
export default voiceService;
