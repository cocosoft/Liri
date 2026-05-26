import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

let _depError: Error | null = null;
let _pdfjsLib: any = null;
let _cMapUrl: string | undefined;
let _loadAttempted = false;

function ensurePdfJsLoaded(): void {
  if (_loadAttempted) return;
  _loadAttempted = true;

  // 尝试1: 标准 require（开发模式 bun run 下正常工作）
  try {
    _pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
    const pdfjsDistPath = dirname(require.resolve('pdfjs-dist/package.json'));
    _cMapUrl = pathToFileURL(resolve(pdfjsDistPath, 'cmaps') + '/').href;
    return;
  } catch {
    // 标准 require 失败，继续尝试其他方式
  }

  // 尝试2: 通过 createRequire 从 exe 同目录加载外部 node_modules
  // 适用场景：bun build --compile 打包后的 exe，配合 --external pdfjs-dist 使用
  try {
    const exeRequire = createRequire(import.meta.url);
    _pdfjsLib = exeRequire('pdfjs-dist/legacy/build/pdf');
    const pdfjsDistPath = dirname(
      exeRequire.resolve('pdfjs-dist/package.json')
    );
    _cMapUrl = pathToFileURL(resolve(pdfjsDistPath, 'cmaps') + '/').href;
    return;
  } catch {
    // 外部路径也失败
  }

  // 尝试3: 最终回退，加载未指定 legacy 的版本
  try {
    _pdfjsLib = require('pdfjs-dist');
  } catch (e2) {
    _depError = e2 as Error;
  }
}

export class PdfConverter extends BaseConverter {
  override readonly name = 'pdf';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.pdf'];
  override readonly supportedMimeTypes = ['application/pdf'];

  override async convert(
    context: ConversionContext
  ): Promise<ConversionResult> {
    ensurePdfJsLoaded();

    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: {
          dependency: 'pdfjs-dist',
          format: 'pdf',
          note: '运行：npm install pdfjs-dist',
        },
        cause: _depError,
      });
    }

    const buffer =
      typeof context.content === 'string'
        ? Buffer.from(context.content, 'utf-8')
        : context.content;

    if (buffer.length === 0) {
      return { markdown: '' };
    }

    const doc = await _pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      cMapUrl: _cMapUrl,
      cMapPacked: true,
    }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item: any) => item.str).join(' ');
      const pageText = text.trim();
      if (pageText) {
        pages.push(pageText);
      }
    }

    return { markdown: pages.join('\n\n') };
  }
}
