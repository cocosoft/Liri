import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

let _depError: Error | null = null;
let _sharp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _sharp = require('sharp');
} catch (e) {
  _depError = e as Error;
}

export class ImageConverter extends BaseConverter {
  override readonly name = 'image';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.webp',
    '.tiff',
    '.svg',
  ];
  override readonly supportedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/webp',
    'image/tiff',
    'image/svg+xml',
  ];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    const buffer =
      typeof context.content === 'string'
        ? Buffer.from(context.content, 'utf-8')
        : context.content;

    const lines: string[] = [];

    if (_sharp) {
      try {
        const metadata = await _sharp(buffer).metadata();
        if (metadata.format)
          lines.push(`**格式:** ${metadata.format.toUpperCase()}`);
        if (metadata.width && metadata.height)
          lines.push(`**尺寸:** ${metadata.width} × ${metadata.height} 像素`);
        if (metadata.density) lines.push(`**DPI:** ${metadata.density}`);
        if (metadata.channels) lines.push(`**通道:** ${metadata.channels}`);
        if (metadata.hasAlpha) lines.push(`**透明度:** 是`);
        if (metadata.space) lines.push(`**色彩空间:** ${metadata.space}`);
      } catch {
        lines.push('*无法读取图片元数据*');
      }
    } else {
      const ext = context.fileInfo.extension.toLowerCase();
      const fileName = context.fileInfo.path.split(/[/\\]/).pop() || 'image';
      lines.push(`**文件:** ${fileName}`);
      lines.push(`**类型:** ${ext.replace('.', '').toUpperCase()}`);
      lines.push(`**大小:** ${buffer.length} 字节`);
      lines.push('');
      lines.push('*需安装 sharp 以获取完整元数据*');
    }

    return { markdown: lines.join('\n') };
  }
}
