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
export interface ConversionResult {
  markdown: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface FileInfo {
  path: string;
  extension: string;
  mimeType: string;
  size: number;
  contentType?: string;
}

export interface ConversionContext {
  fileInfo: FileInfo;
  content: Buffer | string;
  options?: ConversionOptions;
}

export interface ConversionOptions {
  maxFileSize?: number;
  includeMetadata?: boolean;
  formatSpecific?: Record<string, unknown>;
}

export const PRIORITY_SPECIFIC_FILE_FORMAT = 0;
export const PRIORITY_GENERIC_FILE_FORMAT = 10;
export const PRIORITY_FALLBACK = 20;

export const PRIORITY = {
  SPECIFIC: PRIORITY_SPECIFIC_FILE_FORMAT,
  GENERIC: PRIORITY_GENERIC_FILE_FORMAT,
  FALLBACK: PRIORITY_FALLBACK,
} as const;

export interface ConverterRegistration {
  name: string;
  priority: number;
  supportedExtensions: readonly string[];
  supportedMimeTypes: readonly string[];

  accepts(info: FileInfo): boolean;
  convert(context: ConversionContext): Promise<ConversionResult>;
}
