import { AppError } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import type {
  ConversionResult,
  ConversionContext,
  FileInfo,
  ConverterRegistration,
} from './types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools\converter\engine\BaseConverter', level: LogLevel.INFO });

export abstract class BaseConverter implements ConverterRegistration {
  abstract readonly name: string;
  readonly priority: number = PRIORITY_SPECIFIC_FILE_FORMAT;
  readonly supportedExtensions: readonly string[] = [];
  readonly supportedMimeTypes: readonly string[] = [];

  protected depError: Error | null = null;

  accepts(info: FileInfo): boolean {
    if (this.supportedExtensions.length > 0) {
      const ext = info.extension.toLowerCase();
      if (this.supportedExtensions.includes(ext)) {
        return true;
      }
    }
    if (this.supportedMimeTypes.length > 0) {
      const mime = info.mimeType.toLowerCase();
      for (const pattern of this.supportedMimeTypes) {
        if (
          mime === pattern ||
          (pattern.endsWith('/*') && mime.startsWith(pattern.slice(0, -1)))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  protected ensureDependencies(): void {
    if (this.depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        cause: this.depError,
        context: { converterName: this.name },
      });
    }
  }

  abstract convert(context: ConversionContext): Promise<ConversionResult>;
}
