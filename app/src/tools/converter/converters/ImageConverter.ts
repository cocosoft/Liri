import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);

let _loaded = false;
let _sharp: any = null;

/**
 * 延迟加载 sharp（原生插件，bun build --compile 无法内联）
 *
 * 三级加载策略：
 *   1) 标准 require（bun run 开发模式、纯 JS 打包后正常）
 *   2) createRequire + 回退路径（exe 外部 node_modules）
 *   3) 最终回退
 */
function ensureSharpLoaded(): void {
  if (_loaded) return;
  _loaded = true;

  try {
    _sharp = require('sharp');
    return;
  } catch {
    /* 继续尝试下一级 */
  }

  try {
    const exeRequire = createRequire(__filename);
    _sharp = exeRequire('sharp');
  } catch {
    /* sharp 不可用，_sharp 保持 null */
  }
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
    ensureSharpLoaded();

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
