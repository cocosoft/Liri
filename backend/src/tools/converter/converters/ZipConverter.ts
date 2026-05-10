import { BaseConverter } from '../engine/BaseConverter';
import { getConverterEngine } from '../engine/ConverterEngine';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_GENERIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

let _depError: Error | null = null;
let _AdmZip: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _AdmZip = require('adm-zip');
} catch (e) {
  _depError = e as Error;
}

export class ZipConverter extends BaseConverter {
  override readonly name = 'zip';
  override readonly priority = PRIORITY_GENERIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.zip'];
  override readonly supportedMimeTypes = ['application/zip'];

  override async convert(context: ConversionContext): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: { dependency: 'adm-zip', format: 'zip', note: '运行：npm install adm-zip' },
        cause: _depError,
      });
    }

    const buffer = typeof context.content === 'string'
      ? Buffer.from(context.content, 'utf-8')
      : context.content;

    const zip = new _AdmZip(buffer);
    const engine = getConverterEngine();
    const parts: string[] = [];

    const entries = zip.getEntries()
      .filter((e: any) => !e.isDirectory && !e.entryName.startsWith('__MACOSX/'))
      .sort((a: any, b: any) => a.entryName.localeCompare(b.entryName));

    for (const entry of entries) {
      const entryName: string = entry.entryName;
      const entryBuffer: Buffer = entry.getData();

      if (entryBuffer.length === 0) continue;

      try {
        const subFileInfo = {
          path: entryName,
          extension: entryName.includes('.') ? entryName.substring(entryName.lastIndexOf('.')) : '',
          mimeType: 'application/octet-stream' as const,
          size: entryBuffer.length,
        };
        const result = await engine.convertContent(subFileInfo, entryBuffer);

        if (result && result.markdown.trim()) {
          parts.push(`## 文件: ${entryName}\n\n${result.markdown.trim()}`);
        }
      } catch {
        const text = entryBuffer.toString('utf-8').trim();
        if (text) {
          parts.push(`## 文件: ${entryName}\n\n${text}`);
        }
      }
    }

    if (parts.length === 0) {
      return { markdown: '*空 ZIP 文件*' };
    }

    return { markdown: parts.join('\n\n') };
  }
}
