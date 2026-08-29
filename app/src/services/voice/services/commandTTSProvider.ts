/**
 * CommandTTSProvider
 * 自定义命令 TTS 提供者
 * 使用系统自带的命令行工具合成语音
 * - Windows: PowerShell SAPI.SpVoice
 * - macOS: say 命令
 * - Linux: espeak / festival
 */

import { spawn, execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { unlinkSync, writeFileSync } from 'fs';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getPlatform } from '@modules/utils/platform';
import type {
  TTSProvider,
  TTSVoice,
  TTSSpeakOptions,
  TTSSpeakResult,
} from './ttsProvider';

const logger = getLogger('services:voice:services:commandTTSProvider');

/** 平台特定语音列表 */
const PLATFORM_VOICES: Record<string, TTSVoice[]> = {
  win32: [
    { id: 'default', name: '默认语音', language: 'zh-CN', gender: 'female' },
    {
      id: 'Microsoft Huihui',
      name: 'Huihui',
      language: 'zh-CN',
      gender: 'female',
    },
    { id: 'Microsoft Zira', name: 'Zira', language: 'en-US', gender: 'female' },
    { id: 'Microsoft David', name: 'David', language: 'en-US', gender: 'male' },
  ],
  darwin: [
    { id: 'Tingting', name: 'Tingting', language: 'zh-CN', gender: 'female' },
    { id: 'Samantha', name: 'Samantha', language: 'en-US', gender: 'female' },
    { id: 'Alex', name: 'Alex', language: 'en-US', gender: 'male' },
  ],
  linux: [
    { id: 'default', name: '默认语音', language: 'en-US', gender: 'female' },
    { id: 'en', name: '英语', language: 'en-US', gender: 'female' },
    { id: 'zh', name: '中文', language: 'zh-CN', gender: 'female' },
  ],
};

/** 可用命令类型 */
type CommandBackend = 'powershell' | 'say' | 'espeak' | 'festival' | 'none';

/** 命令检测缓存 */
let detectedBackend: CommandBackend | null = null;

/**
 * 检测系统可用的 TTS 命令
 * 检测链：Windows → PowerShell SAPI → macOS → say → Linux → espeak → festival
 */
function detectCommandBackend(): CommandBackend {
  if (detectedBackend) return detectedBackend;

  const platform = process.platform;

  if (platform === 'win32') {
    detectedBackend = 'powershell';
    return 'powershell';
  }

  if (platform === 'darwin') {
    detectedBackend = 'say';
    return 'say';
  }

  if (platform === 'linux') {
    try {
      execSync('which espeak', { stdio: 'ignore' });
      detectedBackend = 'espeak';
      return 'espeak';
    } catch (err) {
      try {
        execSync('which festival', { stdio: 'ignore' });
        detectedBackend = 'festival';
        return 'festival';
      } catch (err) {
        detectedBackend = 'none';
        return 'none';
      }
    }
  }

  detectedBackend = 'none';
  return 'none';
}

/**
 * 重置命令检测缓存（主要用于测试）
 */
export function resetCommandBackendCache(): void {
  detectedBackend = null;
}

/**
 * 获取支持的语音列表
 */
function getAvailableVoices(): TTSVoice[] {
  const platform = getPlatform();
  return PLATFORM_VOICES[platform] || PLATFORM_VOICES['linux'];
}

/**
 * 自定义命令 TTS 提供者
 * 利用系统原生命令实现语音合成，无需额外安装依赖
 */
export class CommandTTSProvider implements TTSProvider {
  readonly name = 'command';
  readonly supportedFormats = ['wav'];

  /**
   * 检查系统是否支持命令 TTS
   */
  static isAvailable(): boolean {
    return detectCommandBackend() !== 'none';
  }

  /**
   * 获取支持的语音列表
   */
  getVoices(): TTSVoice[] {
    return getAvailableVoices();
  }

  /**
   * 合成语音（播放到扬声器）
   */
  async speak(options: TTSSpeakOptions): Promise<TTSSpeakResult> {
    const backend = detectCommandBackend();

    if (backend === 'none') {
      return {
        success: false,
        error:
          '当前系统无可用 TTS 命令（支持的命令: PowerShell SAPI, say, espeak, festival）',
      };
    }

    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.command.tts.speak',
        attributes: { backend, textLength: options.text.length },
      },
      async () => {
        try {
          await this.playText(
            backend,
            options.text,
            options.voice,
            options.speed
          );

          const durationEstimate = this.estimateDuration(
            options.text,
            options.speed
          );

          return {
            success: true,
            audioDurationSec: durationEstimate,
            voice: {
              id: 'default',
              name: '默认语音',
              language: 'en-US',
              gender: 'female',
            } as const,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          void handleError(error, {
            module: 'services:voice:commandTTS',
            action: 'speak',
            context: { backend, textLength: options.text.length },
          });
          return {
            success: false,
            error: `TTS 播放失败: ${errorMsg}`,
          };
        }
      }
    )();
  }

  /**
   * 合成并保存到音频文件
   */
  async save(
    options: TTSSpeakOptions & { filename: string }
  ): Promise<TTSSpeakResult> {
    const backend = detectCommandBackend();

    if (backend === 'none') {
      return {
        success: false,
        error: '当前系统无可用 TTS 命令',
      };
    }

    try {
      await this.saveToFile(
        backend,
        options.text,
        options.filename,
        options.voice,
        options.speed
      );

      const durationEstimate = this.estimateDuration(
        options.text,
        options.speed
      );

      return {
        success: true,
        audioDurationSec: durationEstimate,
        filePath: options.filename,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      void handleError(error, {
        module: 'services:voice:commandTTS',
        action: 'save',
        context: { backend, filePath: options.filename },
      });
      return {
        success: false,
        error: `TTS 保存失败: ${errorMsg}`,
      };
    }
  }

  /**
   * 播放文本语音
   */
  private playText(
    backend: CommandBackend,
    text: string,
    voice?: string,
    speed?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      switch (backend) {
        case 'powershell':
          this.playWithPowerShell(text, resolve, reject, voice, speed);
          break;

        case 'say': {
          const args = [text];
          if (voice) {
            args.unshift('-v', voice);
          }
          if (speed && speed !== 1.0) {
            args.unshift('-r', String(Math.round(speed * 100)));
          }
          const proc = spawn('say', args);
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`say 命令退出码: ${code}`));
          });
          proc.on('error', reject);
          break;
        }

        case 'espeak': {
          const args = [text];
          if (voice && voice !== 'default') {
            args.unshift('-v', voice);
          }
          if (speed) {
            args.unshift('-s', String(Math.round(speed * 175)));
          }
          const proc = spawn('espeak', args);
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`espeak 命令退出码: ${code}`));
          });
          proc.on('error', reject);
          break;
        }

        case 'festival': {
          const escaped = text.replace(/'/g, "'\\''");
          const proc = spawn('sh', [
            '-c',
            `echo '${escaped}' | festival --tts`,
          ]);
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`festival 命令退出码: ${code}`));
          });
          proc.on('error', reject);
          break;
        }

        default:
          reject(new Error(`不支持的 TTS 后端: ${backend}`));
      }
    });
  }

  /**
   * 使用 PowerShell SAPI 播放语音
   */
  private playWithPowerShell(
    text: string,
    resolve: () => void,
    reject: (error: Error) => void,
    voice?: string,
    speed?: number
  ): void {
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, ' ');

    let psScript = `
$speaker = New-Object -ComObject SAPI.SpVoice;
$speaker.Volume = 100;
`;

    if (voice && voice !== 'default') {
      const voiceName = voice.replace(/'/g, "''");
      psScript += `
$voices = $speaker.GetVoices();
$targetVoice = $voices | Where-Object { $_.GetDescription() -like '*${voiceName}*' };
if ($targetVoice) { $speaker.Voice = $targetVoice; }
`;
    }

    if (speed && speed !== 1.0) {
      psScript += `$speaker.Rate = ${Math.round((speed - 1) * 10)};\n`;
    }

    psScript += `$speaker.Speak("${escapedText}");\n`;

    const proc = spawn('powershell', ['-NoProfile', '-Command', psScript], {
      stdio: 'ignore',
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell TTS 退出码: ${code}`));
    });

    proc.on('error', reject);
  }

  /**
   * 保存语音到文件
   */
  private saveToFile(
    backend: CommandBackend,
    text: string,
    filename: string,
    voice?: string,
    speed?: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      switch (backend) {
        case 'powershell':
          this.saveWithPowerShell(
            text,
            filename,
            resolve,
            reject,
            voice,
            speed
          );
          break;

        case 'say': {
          const args = [text, '-o', filename];
          if (voice) args.push('-v', voice);
          if (speed && speed !== 1.0)
            args.push('-r', String(Math.round(speed * 100)));
          const proc = spawn('say', args);
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`say 保存退出码: ${code}`));
          });
          proc.on('error', reject);
          break;
        }

        case 'espeak': {
          const args = ['-w', filename, text];
          if (voice && voice !== 'default') args.unshift('-v', voice);
          if (speed) args.unshift('-s', String(Math.round(speed * 175)));
          const proc = spawn('espeak', args);
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`espeak 保存退出码: ${code}`));
          });
          proc.on('error', reject);
          break;
        }

        case 'festival': {
          const escaped = text.replace(/'/g, "'\\''");
          const festivalScript = `(tts_text "${escaped}" nil '${filename}')`;
          const tmpFile = join(tmpdir(), `festival-${randomUUID()}.scm`);
          writeFileSync(tmpFile, festivalScript);
          const proc = spawn('festival', ['-b', tmpFile]);
          proc.on('close', (code) => {
            try {
              unlinkSync(tmpFile);
            } catch (err) {
              /* 忽略清理错误 */
            }
            if (code === 0) resolve();
            else reject(new Error(`festival 保存退出码: ${code}`));
          });
          proc.on('error', (err) => {
            try {
              unlinkSync(tmpFile);
            } catch (err) {
              /* 忽略清理错误 */
            }
            reject(err);
          });
          break;
        }

        default:
          reject(new Error(`不支持的 TTS 后端: ${backend}`));
      }
    });
  }

  /**
   * 使用 PowerShell 保存语音到文件
   */
  private saveWithPowerShell(
    text: string,
    filename: string,
    resolve: () => void,
    reject: (error: Error) => void,
    voice?: string,
    speed?: number
  ): void {
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, ' ');
    const absFilename = filename.replace(/\\/g, '\\\\');

    let psScript = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.Volume = 100;
`;

    if (voice && voice !== 'default') {
      const voiceName = voice.replace(/'/g, "''");
      psScript += `
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like '*${voiceName}*' };
if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name); }
`;
    }

    if (speed && speed !== 1.0) {
      psScript += `$synth.Rate = ${Math.round((speed - 1) * 10)};\n`;
    }

    psScript += `$synth.SetOutputToWaveFile("${absFilename}");\n`;
    psScript += `$synth.Speak("${escapedText}");\n`;
    psScript += `$synth.Dispose();\n`;

    const proc = spawn('powershell', ['-NoProfile', '-Command', psScript], {
      stdio: 'ignore',
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell TTS 保存退出码: ${code}`));
    });

    proc.on('error', reject);
  }

  /**
   * 估算音频时长（基于文本长度和经验系数）
   */
  private estimateDuration(text: string, speed?: number): number {
    const baseSpeed = speed ?? 1.0;
    const charsPerSecond = 10 * baseSpeed;
    return Math.max(1, Math.round(text.length / charsPerSecond));
  }
}
