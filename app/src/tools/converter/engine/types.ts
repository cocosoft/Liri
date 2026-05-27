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
