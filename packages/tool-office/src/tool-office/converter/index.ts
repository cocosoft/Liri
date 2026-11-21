// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
export { ConverterEngine, getConverterEngine } from './engine/ConverterEngine';
export { ConverterRegistry } from './engine/ConverterRegistry';
export { FileTypeDetector } from './engine/FileTypeDetector';
export { BaseConverter } from './engine/BaseConverter';
export type {
  ConversionResult,
  ConversionContext,
  FileInfo,
  ConversionOptions,
} from './engine/types';
export {
  PRIORITY_SPECIFIC_FILE_FORMAT,
  PRIORITY_GENERIC_FILE_FORMAT,
  PRIORITY_FALLBACK,
  PRIORITY,
} from './engine/types';

export { PlainTextConverter } from './converters/PlainTextConverter';
export { CsvConverter } from './converters/CsvConverter';
export { HtmlConverter } from './converters/HtmlConverter';
export { DocxConverter } from './converters/DocxConverter';
export { XlsxConverter } from './converters/XlsxConverter';
export { XlsConverter } from './converters/XlsConverter';
export { PptxConverter } from './converters/PptxConverter';
export { PdfConverter } from './converters/PdfConverter';
export { ImageConverter } from './converters/ImageConverter';
export { AudioConverter } from './converters/AudioConverter';
export { EpubConverter } from './converters/EpubConverter';
export { ZipConverter } from './converters/ZipConverter';
export { IpynbConverter } from './converters/IpynbConverter';
export { RssConverter } from './converters/RssConverter';
export { OutlookMsgConverter } from './converters/OutlookMsgConverter';
export { htmlToMarkdown, convertString } from './utils/HtmlMarkdownify';
