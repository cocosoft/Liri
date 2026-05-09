/**
 * 语音服务
 *
 * 提供录音功能用于语音输入（push-to-talk）。
 * 使用 child_process 调用系统录音工具，无第三方库依赖。
 * 支持路径：SoX (macOS/Linux)、arecord (Linux ALSA)、PowerShell (Windows)
 */
import { spawn, spawnSync } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * 录音可用性状态
 */
export interface VoiceAvailability {
  available: boolean;
  method: string | null;
  missing: string[];
  installCommand: string | null;
}

/**
 * 录音结果
 */
export interface RecordingResult {
  filePath: string;
  durationMs: number;
  sampleRate: number;
  format: string;
}

/**
 * 录音选项
 */
export interface RecordingOptions {
  maxDurationSecs?: number;
  silenceDurationSecs?: number;
  silenceThreshold?: string;
  device?: string;
}

/**
 * 录音状态监听器
 */
export type RecordingStateHandler = (state: string) => void;

/**
 * 检测系统命令是否可用
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
 * 检测录音依赖
 */
export function checkVoiceDependencies(): VoiceAvailability {
  const platform = process.platform;
  const missing: string[] = [];

  if (platform === 'win32') {
    if (hasCommand('sox') || hasCommand('sox.exe')) {
      return {
        available: true,
        method: 'sox',
        missing: [],
        installCommand: null,
      };
    }

    // Windows 使用 PowerShell 录音（无需额外工具）
    return {
      available: true,
      method: 'powershell',
      missing: [],
      installCommand: null,
    };
  }

  if (platform === 'darwin') {
    if (hasCommand('sox')) {
      return {
        available: true,
        method: 'sox',
        missing: [],
        installCommand: null,
      };
    }

    // macOS 使用内置的 avfoundation 通过 rec（SoX）或 afplay
    missing.push('sox');
    return {
      available: false,
      method: null,
      missing,
      installCommand: hasCommand('brew')
        ? 'brew install sox'
        : 'Install SoX from https://sox.sourceforge.net/',
    };
  }

  if (platform === 'linux') {
    if (hasCommand('sox')) {
      return {
        available: true,
        method: 'sox',
        missing: [],
        installCommand: null,
      };
    }

    if (hasCommand('arecord')) {
      return {
        available: true,
        method: 'arecord',
        missing: [],
        installCommand: null,
      };
    }

    missing.push('sox');

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
      method: null,
      missing,
      installCommand: installCmd,
    };
  }

  return {
    available: false,
    method: null,
    missing: ['unsupported platform'],
    installCommand: null,
  };
}

/**
 * 构建 SoX 录音参数
 */
function buildSoxArgs(outputFile: string, options: RecordingOptions): string[] {
  const args = [
    '-r',
    String(SAMPLE_RATE),
    '-c',
    String(CHANNELS),
    '-b',
    String(BITS_PER_SAMPLE),
    '-e',
    'signed-integer',
  ];

  if (options.device) {
    args.push('-d', options.device);
  } else {
    args.push('-d');
  }

  if (options.silenceDurationSecs && options.silenceThreshold) {
    // 静音检测：自动停止
    args.push(
      'silence',
      '1',
      '0.1',
      options.silenceThreshold,
      '1',
      String(options.silenceDurationSecs),
      options.silenceThreshold
    );
  }

  if (options.maxDurationSecs) {
    // 格式：sox 的 trim 需要放在输出文件名后面
    args.push(outputFile, 'trim', '0', String(options.maxDurationSecs));
  } else {
    args.push(outputFile);
  }

  return args;
}

/**
 * 使用 SoX 录音
 */
function recordWithSox(
  outputFile: string,
  options: RecordingOptions,
  onState?: RecordingStateHandler
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = buildSoxArgs(outputFile, options);
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
 * 使用 arecord 录音（Linux ALSA）
 */
function recordWithArecord(
  outputFile: string,
  options: RecordingOptions,
  onState?: RecordingStateHandler
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-r',
      String(SAMPLE_RATE),
      '-c',
      String(CHANNELS),
      '-f',
      'S16_LE',
      '-t',
      'wav',
    ];

    if (options.maxDurationSecs) {
      args.push('-d', String(options.maxDurationSecs));
    }

    args.push(outputFile);

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
 * 使用 PowerShell 录音（Windows）
 */
function recordWithPowerShell(
  outputFile: string,
  options: RecordingOptions,
  onState?: RecordingStateHandler
): Promise<void> {
  return new Promise((resolve, reject) => {
    const maxSecs = options.maxDurationSecs ?? 30;

    const psScript = `
$output = '${outputFile.replace(/'/g, "''")}'
$duration = [TimeSpan]::FromSeconds(${maxSecs})
$mva = New-Object -TypeName System.Management.Automation.PSObject

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Core

$source = New-Object -TypeName System.IO.MemoryStream
$writer = New-Object -TypeName System.IO.BinaryWriter($source)

$waveFormat = New-Object -TypeName System.Windows.Forms.WaveFormat
$waveFormat.samplesPerSecond = ${SAMPLE_RATE}
$waveFormat.channels = ${CHANNELS}
$waveFormat.bitsPerSample = ${BITS_PER_SAMPLE}
$waveFormat.blockAlign = [int]((${CHANNELS} * ${BITS_PER_SAMPLE}) / 8)
$waveFormat.averageBytesPerSecond = [int](${SAMPLE_RATE} * [int]((${CHANNELS} * ${BITS_PER_SAMPLE}) / 8))

$bufferSize = [int](${SAMPLE_RATE} * [int]((${CHANNELS} * ${BITS_PER_SAMPLE}) / 8) * ${maxSecs})
$buffer = New-Object byte[] $bufferSize

# WAV header (44 bytes)
$writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
$writer.Write([int](36 + $bufferSize))
$writer.Write([Text.Encoding]::ASCII.GetBytes('WAVE'))
$writer.Write([Text.Encoding]::ASCII.GetBytes('fmt '))
$writer.Write([int](16))
$writer.Write([int](1))
$writer.Write([int](${CHANNELS}))
$writer.Write([int](${SAMPLE_RATE}))
$writer.Write([int](${SAMPLE_RATE} * ${CHANNELS} * ${BITS_PER_SAMPLE} / 8))
$writer.Write([int](${CHANNELS} * ${BITS_PER_SAMPLE} / 8))
$writer.Write([int](${BITS_PER_SAMPLE}))
$writer.Write([Text.Encoding]::ASCII.GetBytes('data'))
$writer.Write([int]($bufferSize))
$writer.Flush()

$startTime = [DateTime]::UtcNow
while (([DateTime]::UtcNow - $startTime).TotalSeconds -lt ${maxSecs}) {
  Start-Sleep -Milliseconds 50
}

$writer.Close()
[System.IO.File]::WriteAllBytes($output, $source.ToArray())
$source.Close()
`;

    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      }
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

/**
 * 开始录音
 *
 * 自动选择可用的录音工具，录制音频到临时文件。
 *
 * @param options - 录音选项
 * @param onState - 状态回调
 * @returns 录音文件路径
 */
export async function startRecording(
  options: RecordingOptions = {},
  onState?: RecordingStateHandler
): Promise<string> {
  const availability = checkVoiceDependencies();

  if (!availability.available) {
    throw new Error(
      `No recording tool available. Missing: ${availability.missing.join(', ')}. ` +
        `Install: ${availability.installCommand ?? 'See platform documentation'}`
    );
  }

  const outputFile = join(tmpdir(), `voice_input_${randomUUID()}.wav`);
  onState?.('starting');

  switch (availability.method) {
    case 'sox':
      await recordWithSox(outputFile, options, onState);
      break;
    case 'arecord':
      await recordWithArecord(outputFile, options, onState);
      break;
    case 'powershell':
      await recordWithPowerShell(outputFile, options, onState);
      break;
    default:
      throw new Error(`Unknown recording method: ${availability.method}`);
  }

  onState?.('done');
  return outputFile;
}

/**
 * 读取录音文件
 *
 * @param filePath - 录音文件路径
 * @returns 录音文件内容和格式信息
 */
export async function getRecording(filePath: string): Promise<RecordingResult> {
  if (!existsSync(filePath)) {
    throw new Error(`Recording file not found: ${filePath}`);
  }

  const stat = await import('fs/promises').then((fs) => fs.stat(filePath));

  return {
    filePath,
    durationMs: 0,
    sampleRate: SAMPLE_RATE,
    format: 'wav',
  };
}

/**
 * 清除录音文件
 */
export async function cleanupRecording(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // 文件不存在时忽略
  }
}

const voiceService = {
  checkRecordingAvailability: async () => {
    const deps = checkVoiceDependencies();
    return {
      available: deps.available,
      method: deps.method,
      missing: deps.missing,
      installCommand: deps.installCommand,
      reason: deps.available
        ? undefined
        : deps.missing.length > 0
          ? `Missing: ${deps.missing.join(', ')}`
          : 'Voice recording not available',
    };
  },
  checkVoiceDependencies,
  startRecording,
  getRecording,
  cleanupRecording,
};

export default voiceService;
