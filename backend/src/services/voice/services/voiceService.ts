/**
 * 语音服务
 * 提供语音输入和输出功能
 */

import { type ChildProcess, spawn, spawnSync } from 'child_process';
import { readFile } from 'fs/promises';
import { getPlatform } from '@modules/utils/platform';
import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger({});

import { isEnvTruthy } from '@modules/utils/envUtils';
import type {
  RecordingAvailability,
  VoiceDependencies,
  RecordingOptions,
  SpeechRecognitionResult,
  VoiceServiceConfig,
} from '../models/types';

// 常量定义
const RECORDING_SAMPLE_RATE = 16000;
const RECORDING_CHANNELS = 1;
const SILENCE_DURATION_SECS = '2.0';
const SILENCE_THRESHOLD = '3%';

// 活跃的录音进程
let activeRecorder: ChildProcess | null = null;
let nativeRecordingActive = false;

// 检查命令是否存在
function hasCommand(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], {
    stdio: 'ignore',
    timeout: 3000,
  });
  return result.error === undefined;
}

// 探测arecord是否可用
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

// 检查Linux是否有ALSA声卡
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

// 检测包管理器
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

/**
 * 语音服务类
 */
export class VoiceService {
  private config: VoiceServiceConfig;

  /**
   * 构造函数
   * @param config 语音服务配置
   */
  constructor(config: VoiceServiceConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate || RECORDING_SAMPLE_RATE,
      channels: config.channels || RECORDING_CHANNELS,
      silenceThreshold: config.silenceThreshold ?? SILENCE_THRESHOLD,
      silenceDuration: config.silenceDuration ?? SILENCE_DURATION_SECS,
    };
  }

  /**
   * 检查语音依赖
   */
  async checkVoiceDependencies(): Promise<VoiceDependencies> {
    // 检查是否有录音工具
    const missing: string[] = [];

    // Windows需要检查是否有合适的录音工具
    if (process.platform === 'win32') {
      // Windows默认使用系统录音API
      return { available: true, missing: [], installCommand: null };
    }

    // Linux检查arecord或sox
    if (process.platform === 'linux') {
      if (!hasCommand('arecord') && !hasCommand('rec')) {
        missing.push('arecord (ALSA utils) or sox (rec command)');
      }
    }

    // macOS检查sox
    if (process.platform === 'darwin' && !hasCommand('rec')) {
      missing.push('sox (rec command)');
    }

    const pm = missing.length > 0 ? detectPackageManager() : null;
    return {
      available: missing.length === 0,
      missing,
      installCommand: pm?.displayCommand ?? null,
    };
  }

  /**
   * 检查录音可用性
   */
  async checkRecordingAvailability(): Promise<RecordingAvailability> {
    // 远程环境没有本地麦克风
    if (isEnvTruthy(process.env.PY_APP_REMOTE)) {
      return {
        available: false,
        reason:
          'Voice mode requires microphone access, but no audio device is available in this environment.\n\nTo use voice mode, run PY_APP locally instead.',
      };
    }

    // 检查依赖
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

    // Linux特殊处理
    if (process.platform === 'linux' && hasCommand('arecord')) {
      const probe = await probeArecord();
      if (!probe.ok) {
        if (getPlatform() === 'wsl') {
          return {
            available: false,
            reason:
              'Voice mode could not access an audio device in WSL.\n\nWSL2 with WSLg (Windows 11) provides audio via PulseAudio — if you are on Windows 10 or WSL1, run PY_APP in native Windows instead.',
          };
        }
      }
    }

    return { available: true, reason: null };
  }

  /**
   * 开始录音
   * @param onData 音频数据回调
   * @param onEnd 录音结束回调
   * @param options 录音选项
   */
  async startRecording(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): Promise<boolean> {
    // 停止之前的录音
    this.stopRecording();

    // 检查录音可用性
    const availability = await this.checkRecordingAvailability();
    if (!availability.available) {
      return false;
    }

    // 根据平台选择录音方式
    if (process.platform === 'win32') {
      // Windows使用系统录音API
      // 这里简化处理，实际实现需要使用Windows音频API
      return false;
    } else if (process.platform === 'linux' && hasCommand('arecord')) {
      // Linux使用arecord
      return this.startArecordRecording(onData, onEnd);
    } else if (hasCommand('rec')) {
      // 使用sox rec
      return this.startSoxRecording(onData, onEnd, options);
    }

    return false;
  }

  /**
   * 使用sox rec开始录音
   */
  private startSoxRecording(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): boolean {
    const useSilenceDetection = options?.silenceDetection !== false;

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
      '16',
      '-c',
      String(this.config.channels),
      '-',
    ];

    if (useSilenceDetection) {
      args.push(
        'silence',
        '1',
        '0.1',
        this.config.silenceThreshold ?? SILENCE_THRESHOLD,
        '1',
        this.config.silenceDuration ?? SILENCE_DURATION_SECS,
        this.config.silenceThreshold ?? SILENCE_THRESHOLD
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
      onEnd();
    });

    child.on('error', (err) => {
      logger.error(String(err), { error: String(err) });
      activeRecorder = null;
      onEnd();
    });

    return true;
  }

  /**
   * 使用arecord开始录音
   */
  private startArecordRecording(
    onData: (chunk: Buffer) => void,
    onEnd: () => void
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
      '-q',
      '-',
    ];

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
      onEnd();
    });

    child.on('error', (err) => {
      logger.error(String(err), { error: String(err) });
      activeRecorder = null;
      onEnd();
    });

    return true;
  }

  /**
   * 停止录音
   */
  stopRecording(): void {
    if (activeRecorder) {
      activeRecorder.kill('SIGTERM');
      activeRecorder = null;
    }
  }

  /**
   * 语音识别
   * @param audioData 音频数据
   */
  async recognizeSpeech(
    audioData: Buffer
  ): Promise<SpeechRecognitionResult | null> {
    // 这里简化处理，实际实现需要调用语音识别API
    // 例如Google Speech-to-Text、Azure Speech Services等
    return null;
  }

  /**
   * 语音合成
   * @param text 文本
   */
  async synthesizeSpeech(text: string): Promise<Buffer | null> {
    // 这里简化处理，实际实现需要调用语音合成API
    // 例如Google Text-to-Speech、Azure Speech Services等
    return null;
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
