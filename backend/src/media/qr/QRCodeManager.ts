/**
 * QRCodeManager QR 码生成与解析
 * 对标 OpenClaw 的二维码处理
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/**
 * QR 码选项
 */
export interface QRCodeOptions {
  size?: number;
  format?: 'png' | 'svg' | 'text';
  errorLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
}

/**
 * QR 码管理器
 */
export class QRCodeManager {
  /**
   * 生成 QR 码
   */
  async generate(text: string, outputPath: string, options?: QRCodeOptions): Promise<boolean> {
    try {
      const args: string[] = [];

      if (options?.size) {
        args.push('-s', String(options.size));
      }

      if (options?.margin !== undefined) {
        args.push('-m', String(options.margin));
      }

      if (options?.errorLevel) {
        args.push('-l', options.errorLevel);
      }

      if (options?.format === 'svg') {
        args.push('-t', 'svg', '-o', outputPath, text);
      } else {
        args.push('-o', outputPath, text);
      }

      return await this.runQrencode(args);
    } catch {
      return false;
    }
  }

  /**
   * 生成文本 QR 码
   */
  async generateText(text: string): Promise<string | null> {
    try {
      const args = ['-t', 'ansiutf8', '-o', '-', text];

      return await this.runQrencodeCapture(args);
    } catch {
      return null;
    }
  }

  /**
   * 解析 QR 码
   */
  async decode(imagePath: string): Promise<string | null> {
    try {
      if (!fs.existsSync(imagePath)) return null;

      return await this.runZbarDecode(imagePath);
    } catch {
      return null;
    }
  }

  /**
   * 检查工具可用性
   */
  async isQrencodeAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('qrencode', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });

      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * 运行 qrencode
   */
  private async runQrencode(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('qrencode', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * 运行 qrencode 并捕获输出
   */
  private async runQrencodeCapture(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('qrencode', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let data = '';

      proc.stdout.on('data', (chunk: Buffer) => { data += chunk.toString(); });

      proc.on('close', (code) => resolve(code === 0 ? data : null));
      proc.on('error', () => resolve(null));
    });
  }

  /**
   * 运行 zbarimg 解码
   */
  private async runZbarDecode(imagePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('zbarimg', ['-q', imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let data = '';

      proc.stdout.on('data', (chunk: Buffer) => { data += chunk.toString(); });

      proc.on('close', () => {
        const match = data.match(/QR-Code:(.+)/);

        resolve(match ? match[1].trim() : null);
      });

      proc.on('error', () => resolve(null));
    });
  }
}

export const qrCodeManager = new QRCodeManager();
