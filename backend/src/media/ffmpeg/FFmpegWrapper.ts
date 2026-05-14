/**
 * FFmpegWrapper FFmpeg 封装
 * 对标 OpenClaw 的 FFmpeg 集成
 */
import { spawn } from 'node:child_process';

/**
 * FFmpeg 选项
 */
export interface FFmpegOptions {
  input: string;
  output: string;
  args: string[];
  timeout?: number;
}

/**
 * FFprobe 结果
 */
export interface FFprobeResult {
  streams: Array<{
    index: number;
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    duration?: number;
  }>;
  format: {
    duration: number;
    size: number;
    bit_rate: number;
  };
}

/**
 * FFmpeg 封装器
 */
export class FFmpegWrapper {
  /**
   * 运行 FFmpeg
   */
  async run(
    options: FFmpegOptions
  ): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const args = ['-i', options.input, ...options.args, '-y', options.output];
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = options.timeout
        ? setTimeout(() => {
            proc.kill();
            resolve({ success: false, stdout, stderr: stderr + '\nTIMEOUT' });
          }, options.timeout)
        : null;

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ success: code === 0, stdout, stderr });
      });

      proc.on('error', () => {
        if (timer) clearTimeout(timer);
        resolve({ success: false, stdout, stderr: 'Failed to spawn ffmpeg' });
      });
    });
  }

  /**
   * 运行 FFprobe
   */
  async probe(input: string): Promise<FFprobeResult | null> {
    return new Promise((resolve) => {
      const args = [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        input,
      ];
      const proc = spawn('ffprobe', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve(null);

          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * 检查 FFmpeg 可用性
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-version'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }
}

export const ffmpegWrapper = new FFmpegWrapper();
