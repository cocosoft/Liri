import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\converter\converters\AudioConverter',
  level: LogLevel.INFO,
});

let _depError: Error | null = null;
let _ffprobe: any = null;
try {
  const Ffmpeg = require('fluent-ffmpeg');
  _ffprobe = Ffmpeg.ffprobe;
} catch (e) {
  _depError = e as Error;
}

export class AudioConverter extends BaseConverter {
  override readonly name = 'audio';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = [
    '.mp3',
    '.wav',
    '.m4a',
    '.ogg',
    '.flac',
    '.aac',
    '.wma',
  ];
  override readonly supportedMimeTypes = [
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/ogg',
    'audio/flac',
    'audio/aac',
    'audio/x-ms-wma',
  ];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: {
          dependency: 'fluent-ffmpeg',
          format: 'audio',
          note: '运行：npm install fluent-ffmpeg',
        },
        cause: _depError,
      });
    }

    const buffer =
      typeof context.content === 'string'
        ? Buffer.from(context.content, 'utf-8')
        : context.content;

    const lines: string[] = [];
    const fileName = context.fileInfo.path.split(/[/\\]/).pop() || 'audio';
    const ext = context.fileInfo.extension.toLowerCase();
    lines.push(`**文件:** ${fileName}`);
    lines.push(`**格式:** ${ext.replace('.', '').toUpperCase()}`);

    try {
      const metadata = await this.getMetadata(buffer);
      if (metadata) {
        if (metadata.title) lines.push(`**标题:** ${metadata.title}`);
        if (metadata.artist) lines.push(`**艺术家:** ${metadata.artist}`);
        if (metadata.album) lines.push(`**专辑:** ${metadata.album}`);
        if (metadata.duration)
          lines.push(`**时长:** ${this.formatDuration(metadata.duration)}`);
        if (metadata.bitrate)
          lines.push(`**比特率:** ${Math.round(metadata.bitrate / 1000)} kbps`);
        if (metadata.sampleRate)
          lines.push(`**采样率:** ${metadata.sampleRate} Hz`);
        if (metadata.channels) lines.push(`**声道:** ${metadata.channels}`);
      }
    } catch {
      lines.push('*无法读取音频元数据*');
    }

    return { markdown: lines.join('\n') };
  }

  private getMetadata(buffer: Buffer): Promise<AudioMeta | null> {
    return new Promise((resolve) => {
      try {
        _ffprobe(buffer, (err: any, data: any) => {
          if (err || !data) {
            resolve(null);
            return;
          }

          const stream = data.streams?.find(
            (s: any) => s.codec_type === 'audio'
          );
          const format = data.format;

          resolve({
            title: format?.tags?.title || '',
            artist: format?.tags?.artist || '',
            album: format?.tags?.album || '',
            duration: format?.duration ? parseFloat(format.duration) : 0,
            bitrate: format?.bit_rate ? parseInt(format.bit_rate, 10) : 0,
            sampleRate: stream?.sample_rate
              ? parseInt(stream.sample_rate, 10)
              : 0,
            channels: stream?.channels || 0,
          });
        });
      } catch {
        resolve(null);
      }
    });
  }

  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}

interface AudioMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
}
