import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { resolve, dirname } from 'path';
import { pathToFileURL } from 'url';

let _depError: Error | null = null;
let _pdfjsLib: any = null;
let _standardFontDataUrl: string | undefined;
let _cMapUrl: string | undefined;
try {
  _pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
  const pdfjsDistPath = dirname(require.resolve('pdfjs-dist/package.json'));
  _standardFontDataUrl = pathToFileURL(
    resolve(pdfjsDistPath, 'standard_fonts') + '/'
  ).href;
  _cMapUrl = pathToFileURL(resolve(pdfjsDistPath, 'cmaps') + '/').href;
} catch (e) {
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
      standardFontDataUrl: _standardFontDataUrl,
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
